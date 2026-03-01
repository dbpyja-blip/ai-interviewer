/**
 * Recording Hook for Udemy-style Segmented Video Recording
 * 
 * This hook handles:
 * - Browser MediaRecorder API for local recording
 * - Phase transition tracking
 * - Transcript saving with timestamps
 * - Video upload and segmentation
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Room, LocalVideoTrack, LocalAudioTrack } from "livekit-client";
import { apiUrl } from "@/config";

interface RecordingState {
  isRecording: boolean;
  recordingStartTime: number | null;
  currentPhase: string;
  error: string | null;
}

interface PhaseTransition {
  fromPhase: string;
  toPhase: string;
  timestamp: number;
  reason?: string;
}

export function useRecording(sessionId: string, room: Room | null) {
  const [recordingState, setRecordingState] = useState<RecordingState>({
    isRecording: false,
    recordingStartTime: null,
    currentPhase: "introduction",
    error: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const phaseTransitionsRef = useRef<PhaseTransition[]>([]);
  const transcriptsRef = useRef<Array<{ name: string; message: string; timestamp: number; is_self: boolean }>>([]);

  // Start recording
  const startRecording = useCallback(async () => {
    if (!room || !sessionId) {
      console.error("❌ Recording: Room or session ID not available", { room: !!room, sessionId });
      setRecordingState((prev) => ({ ...prev, error: "Room or session ID not available" }));
      return false;
    }

    try {
      console.log("🎥 Starting recording...", { sessionId, roomName: room.name });
      
      // Get local video and audio tracks
      const localTracks: (LocalVideoTrack | LocalAudioTrack)[] = [];
      
      // Get local video track
      room.localParticipant.videoTrackPublications.forEach((pub) => {
        if (pub.track && pub.track.mediaStreamTrack) {
          localTracks.push(pub.track as LocalVideoTrack);
          console.log("   ✅ Found local video track");
        }
      });

      // Get local audio track (microphone) - but don't rely on it for recording
      // because it might be muted by the user during the interview
      room.localParticipant.audioTrackPublications.forEach((pub) => {
        if (pub.track) {
          if (pub.isMuted) {
            console.warn("   ⚠️ Local audio track is muted (but recording will use separate stream)");
          }
          if (pub.track.mediaStreamTrack && !pub.isMuted) {
            // Only use if not muted, otherwise we'll use direct capture below
            localTracks.push(pub.track as LocalAudioTrack);
            console.log("   ✅ Found local audio track (microphone)", { 
              enabled: !pub.isMuted, 
              kind: pub.track.mediaStreamTrack.kind 
            });
          }
        }
      });

      // Get remote tracks (agent audio)
      room.remoteParticipants.forEach((participant) => {
        participant.audioTrackPublications.forEach((pub) => {
          if (pub.track && pub.track.mediaStreamTrack) {
            localTracks.push(pub.track as any);
            console.log("   ✅ Found remote audio track (agent)");
          }
        });
      });
      
      console.log(`   📊 Total tracks found: ${localTracks.length}`);

      // Create MediaStream from tracks
      const stream = new MediaStream();
      localTracks.forEach((track) => {
        if (track.mediaStreamTrack) {
          stream.addTrack(track.mediaStreamTrack);
          console.log(`   ✅ Added ${track.mediaStreamTrack.kind} track: ${track.mediaStreamTrack.label}`);
        }
      });
      
      // CRITICAL: ALWAYS get a SEPARATE microphone stream for recording
      // This stream is INDEPENDENT of the LiveKit mute/unmute functionality
      // So even if user mutes their mic in the UI, recording continues
      console.log(`   📊 Stream tracks before adding recording mic: ${stream.getVideoTracks().length} video, ${stream.getAudioTracks().length} audio`);
      
      try {
        console.log("   🎤 Getting SEPARATE microphone stream for recording (independent of mute button)...");
        const recordingMicStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 1
          }
        });
        
        // Add this SEPARATE microphone track to the recording stream
        // This track is ALWAYS enabled and records even when UI mic is muted
        recordingMicStream.getAudioTracks().forEach(track => {
          // FORCE track to be enabled - this ensures recording never stops
          track.enabled = true;
          stream.addTrack(track);
          console.log("   ✅ Added SEPARATE recording microphone (always active, independent of mute)", {
            label: track.label,
            enabled: track.enabled,
            readyState: track.readyState
          });
        });
        
        console.log("   ✅ Recording microphone will capture audio EVEN WHEN UI MIC IS MUTED");
      } catch (mediaError) {
        console.error("   ❌ Could not get recording microphone:", mediaError);
        console.error("   ⚠️ User audio will NOT be captured in recording!");
        
        if ((mediaError as any).name === 'NotAllowedError') {
          console.error("   ❌ Microphone permission denied!");
        } else if ((mediaError as any).name === 'NotFoundError') {
          console.error("   ❌ No microphone found!");
        }
      }
      
      // Ensure we have video track
      if (stream.getVideoTracks().length === 0) {
        console.warn("   ⚠️ No video tracks, getting camera directly...");
        try {
          const userVideo = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          });
          userVideo.getVideoTracks().forEach(track => {
            stream.addTrack(track);
            console.log("   ✅ Added direct camera track");
          });
        } catch (mediaError) {
          console.error("   ❌ Failed to get user camera:", mediaError);
        }
      }
      
      console.log(`   📊 Final stream: ${stream.getVideoTracks().length} video, ${stream.getAudioTracks().length} audio tracks`);
      
      // Final check
      if (stream.getTracks().length === 0) {
        console.error("❌ No tracks available for recording after all attempts");
        setRecordingState((prev) => ({ ...prev, error: "No tracks available for recording" }));
        return false;
      }
      
      console.log(`   ✅ Final stream: ${stream.getVideoTracks().length} video, ${stream.getAudioTracks().length} audio tracks`);

      // CRITICAL: Mix all audio tracks into one using Web Audio API
      // MediaRecorder might only record the first audio track, so we need to mix them
      const audioTracks = stream.getAudioTracks();
      let finalStream = stream;
      
      if (audioTracks.length >= 1) {
        console.log(`   🎚️ Mixing ${audioTracks.length} audio tracks into one...`);
        
        try {
          // Create audio context for mixing
          const audioContext = new AudioContext({ sampleRate: 48000 });
          const destination = audioContext.createMediaStreamDestination();
          
          // Mix each audio track
          audioTracks.forEach((track, index) => {
            console.log(`      - Mixing audio track ${index + 1}: ${track.label} (enabled: ${track.enabled}, readyState: ${track.readyState})`);
            
            try {
              const audioStream = new MediaStream([track]);
              const source = audioContext.createMediaStreamSource(audioStream);
              
              // Create gain node for volume control
              const gainNode = audioContext.createGain();
              gainNode.gain.value = 1.5; // Boost volume slightly to ensure audibility
              
              // Connect: source -> gain -> destination
              source.connect(gainNode);
              gainNode.connect(destination);
              
              console.log(`         ✅ Connected audio track ${index + 1} to mixer`);
            } catch (trackError) {
              console.error(`         ❌ Failed to mix track ${index + 1}:`, trackError);
            }
          });
          
          // Verify destination has audio
          const mixedTracks = destination.stream.getAudioTracks();
          if (mixedTracks.length > 0) {
            // Create new stream with mixed audio and video
            finalStream = new MediaStream();
            
            // Add video tracks
            stream.getVideoTracks().forEach(track => finalStream.addTrack(track));
            
            // Add mixed audio track
            mixedTracks.forEach(track => {
              finalStream.addTrack(track);
              console.log(`   ✅ Added mixed audio track: ${track.label}`);
            });
            
            console.log(`   ✅ Audio mixing complete: ${finalStream.getAudioTracks().length} audio track (mixed from ${audioTracks.length} sources)`);
          } else {
            throw new Error("No mixed audio tracks produced");
          }
        } catch (mixError) {
          console.error("   ❌ Failed to mix audio tracks:", mixError);
          console.warn("   ⚠️ Falling back to original stream");
          finalStream = stream;
        }
      } else {
        console.warn(`   ⚠️ No audio tracks in stream!`);
      }

      // Create MediaRecorder with the final stream (with mixed audio)
      const options: MediaRecorderOptions = {
        mimeType: "video/webm;codecs=vp9,opus",
        videoBitsPerSecond: 2500000, // 2.5 Mbps
        audioBitsPerSecond: 128000, // 128 Kbps for audio
      };

      // Fallback to VP8 if VP9 not supported
      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        options.mimeType = "video/webm;codecs=vp8,opus";
      }

      // Final fallback
      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        options.mimeType = "video/webm";
      }

      console.log(`   🎬 Creating MediaRecorder with codec: ${options.mimeType}`);
      const mediaRecorder = new MediaRecorder(finalStream, options);
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Combine all chunks into a single blob
        const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
        
        // Upload video to backend
        await uploadRecording(blob);
      };

      console.log(`   🎬 Starting MediaRecorder with ${stream.getTracks().length} tracks`);
      mediaRecorder.start(1000); // Collect data every second
      console.log("   ✅ MediaRecorder started");

      // Notify backend that recording started
      try {
        const response = await fetch(
          apiUrl(`/api/recording/start?session_id=${sessionId}&room_name=${room.name}`),
          {
          method: "POST",
        });
        if (response.ok) {
          const result = await response.json();
          console.log("   ✅ Backend notified:", result);
        } else {
          console.warn("   ⚠️ Backend notification failed:", response.status);
        }
      } catch (fetchError) {
        console.error("   ❌ Failed to notify backend:", fetchError);
        // Continue anyway - recording is still active
      }

      // Record initial phase - notify backend directly
      try {
        await fetch(apiUrl("/api/recording/phase-transition"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            new_phase: "introduction",
            reason: "Recording started",
          }),
        });
        console.log("   📊 Initial phase recorded: introduction");
      } catch (error) {
        console.error("   ⚠️ Failed to record initial phase:", error);
      }

      setRecordingState({
        isRecording: true,
        recordingStartTime: Date.now(),
        currentPhase: "introduction",
        error: null,
      });

      console.log("🎉 Recording started successfully!");
      return true;
    } catch (error: any) {
      console.error("❌ Failed to start recording:", error);
      setRecordingState((prev) => ({ ...prev, error: error.message }));
      return false;
    }
  }, [room, sessionId]);

  // Stop recording
  const stopRecording = useCallback(async () => {
    if (!mediaRecorderRef.current || !recordingState.isRecording) {
      return;
    }

    try {
      mediaRecorderRef.current.stop();
      
      // Stop all tracks
      if (mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      }

      // Notify backend
      await fetch(apiUrl(`/api/recording/stop?session_id=${sessionId}`), {
        method: "POST",
      });

      setRecordingState((prev) => ({
        ...prev,
        isRecording: false,
      }));

      return true;
    } catch (error: any) {
      console.error("Failed to stop recording:", error);
      setRecordingState((prev) => ({ ...prev, error: error.message }));
      return false;
    }
  }, [sessionId, recordingState.isRecording]);

  // Record phase transition
  const recordPhaseTransition = useCallback(async (newPhase: string, reason?: string) => {
    const currentPhase = recordingState.currentPhase;
    
    if (newPhase === currentPhase) {
      return; // No change
    }

    const transition: PhaseTransition = {
      fromPhase: currentPhase,
      toPhase: newPhase,
      timestamp: Date.now(),
      reason,
    };

    phaseTransitionsRef.current.push(transition);

    // Notify backend
    try {
      await fetch(apiUrl("/api/recording/phase-transition"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          new_phase: newPhase,
          reason,
        }),
      });
    } catch (error) {
      console.error("Failed to record phase transition:", error);
    }

    setRecordingState((prev) => ({
      ...prev,
      currentPhase: newPhase,
    }));
  }, [sessionId, recordingState.currentPhase]);

  // Save transcript entry
  const saveTranscriptEntry = useCallback(async (
    name: string,
    message: string,
    isSelf: boolean
  ) => {
    const entry = {
      name,
      message,
      timestamp: Date.now(),
      is_self: isSelf,
    };

    transcriptsRef.current.push(entry);

    // Notify backend
    try {
      const response = await fetch(apiUrl("/api/recording/transcript"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          ...entry,
        }),
      });
      if (!response.ok) {
        console.warn(`Failed to save transcript entry: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error("Failed to save transcript entry:", error);
    }
  }, [sessionId]);

  // Upload recording to backend
  const uploadRecording = useCallback(async (blob: Blob) => {
    try {
      const formData = new FormData();
      formData.append("video", blob, `recording_${sessionId}.webm`);
      formData.append("session_id", sessionId);

      const response = await fetch(apiUrl("/api/recording/upload"), {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to upload recording");
      }

      const result = await response.json();
      
      // Trigger segmentation
      if (result.video_path) {
        await fetch(apiUrl("/api/recording/segment"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            video_path: result.video_path,
          }),
        });
      }

      return result;
    } catch (error) {
      console.error("Failed to upload recording:", error);
      throw error;
    }
  }, [sessionId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && recordingState.isRecording) {
        mediaRecorderRef.current.stop();
      }
    };
  }, [recordingState.isRecording]);

  return {
    ...recordingState,
    startRecording,
    stopRecording,
    recordPhaseTransition,
    saveTranscriptEntry,
    phaseTransitions: phaseTransitionsRef.current,
    transcripts: transcriptsRef.current,
  };
}

