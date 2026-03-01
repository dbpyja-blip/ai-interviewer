"use client";

import { LoadingSVG } from "@/components/button/LoadingSVG";
import { ChatMessageType } from "@/components/chat/ChatTile";
import { PlaygroundHeader } from "./PlaygroundHeader";
import { CodeEditorModal } from "./CodeEditorModal";
import {
  PlaygroundTab,
  PlaygroundTabbedTile,
  PlaygroundTile,
} from "./PlaygroundTile";
import { useConfig } from "@/hooks/useConfig";
import { TranscriptionTile } from "@/transcriptions/TranscriptionTile";
import { useRecording } from "@/hooks/useRecording";
import {
  BarVisualizer,
  VideoTrack,
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
  useRoomInfo,
  useTracks,
  useVoiceAssistant,
  useRoomContext,
} from "@livekit/components-react";
import { ConnectionState, LocalParticipant, Track } from "livekit-client";
import { ReactNode, useCallback, useEffect, useMemo, useState, useRef } from "react";
import tailwindTheme from "../../lib/tailwindTheme.preval";
import type { TrackPublication } from "livekit-client";
import { apiUrl } from "@/config";
import { TalkingHeadAvatar } from "@/components/avatar/TalkingHeadAvatar";

// Helper function to capture frame from video track
const captureFrameFromTrack = async (trackRef: any): Promise<string | null> => {
  try {
    if (!trackRef?.publication?.track) return null;
    
    const track = trackRef.publication.track;
    const videoElement = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return null;
    
    // Attach the track to video element
    videoElement.srcObject = new MediaStream([track.mediaStreamTrack]);
    videoElement.muted = true; // Prevent audio issues
    
    // Wait for video to be ready AND first frame to render
    await new Promise((resolve) => {
      let resolved = false;
      
      // Wait for metadata first
      videoElement.onloadedmetadata = () => {
        if (!resolved) {
          // Additional wait for first frame to be rendered
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve(undefined);
            }
          }, 800); // Give 800ms for frame to render properly
        }
      };
      
      // Backup: resolve after 3 seconds max
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(undefined);
        }
      }, 3000);
      
      videoElement.play().catch(console.error);
    });
    
    // Ensure video dimensions are available
    if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
      console.warn('Video dimensions not available, using default size');
      canvas.width = 1920;
      canvas.height = 1080;
    } else {
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;
    }
    
    // Draw video frame to canvas
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    
    // Convert to base64 with better quality
    const base64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
    
    console.log(`📸 Frame captured: ${canvas.width}x${canvas.height}, ~${Math.round(base64.length * 0.75 / 1024)}KB`);
    
    // Cleanup
    videoElement.pause();
    videoElement.srcObject = null;
    
    return base64;
  } catch (error) {
    console.error('Error capturing frame:', error);
    return null;
  }
};

export interface PlaygroundMeta {
  name: string;
  value: string;
}

export interface PlaygroundProps {
  logo?: ReactNode;
  themeColors: string[];
  onConnect: (connect: boolean, opts?: { token: string; url: string }) => void;
  onEndCall?: (transcripts: ChatMessageType[]) => void;
}

const headerHeight = 56;

export default function Playground({
  logo,
  themeColors,
  onConnect,
  onEndCall,
}: PlaygroundProps) {
  const { config, setUserSettings } = useConfig();
  const { name } = useRoomInfo();
  const [transcripts, setTranscripts] = useState<ChatMessageType[]>([]);
  const [allTranscripts, setAllTranscripts] = useState<ChatMessageType[]>([]);
  const { localParticipant } = useLocalParticipant();
  // Screen sharing functionality removed - no longer needed
  // const [screenShareWarning, setScreenShareWarning] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  
  // Code Editor Modal State
  const [isCodeEditorOpen, setIsCodeEditorOpen] = useState(false);
  
  // External message state for code editor -> chat injection
  const [externalChatMessage, setExternalChatMessage] = useState<string | null>(null);
  
  // Avatar state - prevent agent from speaking until avatar is ready
  const [isAvatarReady, setIsAvatarReady] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  
  // Screen sharing enforcement removed - no longer using screen sharing
  /*
  // Force Chrome/Edge/etc to allow ONLY "Entire Screen" sharing (monitor)
  useEffect(() => {
    const mediaDevices = navigator.mediaDevices as MediaDevices & {
      __forceEntireScreenPatched?: boolean;
      __originalGetDisplayMedia?: typeof navigator.mediaDevices.getDisplayMedia;
    };

    if (!mediaDevices || mediaDevices.__forceEntireScreenPatched) {
      return;
    }

    const originalGetDisplayMedia = mediaDevices.getDisplayMedia?.bind(mediaDevices);
    if (!originalGetDisplayMedia) {
      return;
    }

    mediaDevices.__forceEntireScreenPatched = true;
    mediaDevices.__originalGetDisplayMedia = originalGetDisplayMedia;

    mediaDevices.getDisplayMedia = async (constraints?: DisplayMediaStreamOptions) => {
      const stream = await originalGetDisplayMedia(constraints);
      const videoTrack = stream.getVideoTracks?.()[0];
      const displaySurface = videoTrack?.getSettings?.().displaySurface;

      // Firefox currently reports undefined - treat as acceptable
      if (displaySurface && displaySurface !== "monitor") {
        videoTrack?.stop();
        setScreenShareWarning(
          "Please share your ENTIRE SCREEN (not a window or browser tab). Click 'Share again' → choose 'Entire Screen'."
        );
        throw new DOMException(
          "Only entire screen sharing is permitted",
          "NotAllowedError"
        );
      }
      setScreenShareWarning(null);

      return stream;
    };

    return () => {
      if (mediaDevices.__originalGetDisplayMedia) {
        mediaDevices.getDisplayMedia = mediaDevices.__originalGetDisplayMedia;
      }
      delete mediaDevices.__forceEntireScreenPatched;
      delete mediaDevices.__originalGetDisplayMedia;
    };
  }, []);
  */
  
  const [chatEnabled, setChatEnabled] = useState<boolean>(false);

  const voiceAssistant = useVoiceAssistant();

  const roomState = useConnectionState();
  const tracks = useTracks();
  const room = useRoomContext();
  
  // Recording hook - handles video recording and phase tracking
  const recording = useRecording(sessionId, room);

  const [rpcMethod, setRpcMethod] = useState("");
  const [rpcPayload, setRpcPayload] = useState("");

  // Add a ref to track if we've connected before to prevent auto-reconnection
  const hasConnectedBefore = useRef(false);

  // Face detection and vision analysis state
  const [faceDetectionWarning, setFaceDetectionWarning] = useState<string | null>(null);
  const faceDetectionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const visionAnalysisIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastFaceAnalysisTimeRef = useRef<number>(0);
  const lastScreenAnalysisTimeRef = useRef<number>(0);
  
  // Store latest frames for immediate analysis
  const latestFaceFrameRef = useRef<string | null>(null);
  const latestScreenFrameRef = useRef<string | null>(null);
  const isAnalyzingCodeRef = useRef<boolean>(false);
  
  // Track face captures (every 50 seconds during interview)
  const faceCaptureCountRef = useRef<number>(0);
  const faceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const faceIntervalSeconds = 50; // Capture face every 50 seconds
  const maxFaceCaptures = 100; // Allow many captures for long interviews

  // Initialize session ID
  useEffect(() => {
    const storedSessionId = localStorage.getItem("currentSessionId") || `session_${Date.now()}`;
    setSessionId(storedSessionId);
    localStorage.setItem("currentSessionId", storedSessionId);
    
    console.log(`📸 Face capture will occur every ${faceIntervalSeconds} seconds`);
  }, []);

  // Start recording when room connects
  useEffect(() => {
    if (roomState === ConnectionState.Connected && room && sessionId && !recording.isRecording) {
      console.log("🎥 Playground: Room connected, attempting to start recording...");
      console.log("   Room state:", { 
        connected: roomState === ConnectionState.Connected,
        hasRoom: !!room,
        sessionId,
        isRecording: recording.isRecording 
      });
      
      // Add a small delay to ensure tracks are ready
      const timer = setTimeout(() => {
        recording.startRecording().then((success) => {
          if (success) {
            console.log("✅ Playground: Recording started successfully");
          } else {
            console.warn("⚠️ Playground: Recording start failed, continuing without recording");
            console.warn("   Error:", recording.error);
          }
        }).catch((error) => {
          console.error("❌ Playground: Recording start error:", error);
        });
      }, 2000); // Wait 2 seconds for tracks to be ready
      
      return () => clearTimeout(timer);
    }
  }, [roomState, room, sessionId, recording.isRecording, recording]);

  // Save transcripts to recording system
  const savedTranscriptIdsRef = useRef<Set<string>>(new Set());
  
  useEffect(() => {
    if (allTranscripts.length > 0 && recording.isRecording) {
      const lastTranscript = allTranscripts[allTranscripts.length - 1];
      
      // Create unique ID for this transcript to avoid duplicates
      const transcriptId = `${lastTranscript.timestamp}_${lastTranscript.name}_${lastTranscript.message.substring(0, 20)}`;
      
      // Only save if we haven't saved this transcript before
      if (!savedTranscriptIdsRef.current.has(transcriptId)) {
        console.log(`📝 Saving transcript: ${lastTranscript.name}: ${lastTranscript.message.substring(0, 50)}...`);
        
        recording.saveTranscriptEntry(
          lastTranscript.name,
          lastTranscript.message,
          lastTranscript.isSelf
        );
        
        savedTranscriptIdsRef.current.add(transcriptId);
      }
    }
  }, [allTranscripts, recording.isRecording, recording]);

  // Capture face frame (called every 10 seconds during interview)
  const captureFaceFrame = useCallback(async () => {
    if (!sessionId) return;
    
    // Check if we've reached the max captures
    if (faceCaptureCountRef.current >= maxFaceCaptures) {
      console.log(`📸 Max face captures reached (${maxFaceCaptures})`);
      return;
    }
    
    // Get local video track dynamically
    const localTracks = tracks.filter(
      ({ participant }) => participant instanceof LocalParticipant
    );
    const videoTrack = localTracks.find(
      ({ source }) => source === Track.Source.Camera
    );
    
    if (!videoTrack) {
      console.log('📷 No video track available for face capture');
      return;
    }
    
    try {
      const frameData = await captureFrameFromTrack(videoTrack);
      if (frameData) {
        // Increment capture count
        faceCaptureCountRef.current++;
        
        // Store latest frame for immediate analysis
        latestFaceFrameRef.current = frameData;
        
        // Clear face detection warning once we have a frame
        setFaceDetectionWarning(null);
        
        console.log(`📸 Face captured #${faceCaptureCountRef.current} at ${new Date().toLocaleTimeString()}`);
        
        // Send to backend for analysis
        fetch(apiUrl("/api/vision-analyze"), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            frame_data: frameData,
            frame_type: 'face',
            timestamp: Date.now()
          })
        })
        .then(response => response.json())
        .then(result => {
          console.log('✅ Backend Response (Face Analysis):', result);
          if (result.success && result.analysis) {
            console.log('   Type:', result.analysis.type);
            console.log('   Detections:', result.analysis.detection_count || 0);
            if (result.analysis.proctoring) {
              console.log('   🚨 Proctoring Data:', result.analysis.proctoring);
              if (result.analysis.proctoring.red_flags && result.analysis.proctoring.red_flags.length > 0) {
                console.warn('   ⚠️ RED FLAGS:', result.analysis.proctoring.red_flags);
              }
            }
          }
        })
        .catch(err => console.error('❌ Face analysis failed:', err));
      } else {
        console.log('❌ Failed to capture face frame');
      }
    } catch (error) {
      console.error('Error capturing face frame:', error);
    }
  }, [sessionId, tracks, maxFaceCaptures]);

  useEffect(() => {
    if (roomState === ConnectionState.Connected) {
      hasConnectedBefore.current = true;
      localParticipant.setCameraEnabled(config.settings.inputs.camera);
      localParticipant.setMicrophoneEnabled(config.settings.inputs.mic);

      // Start face detection timer (12 seconds) - only show if camera is actually off
      if (config.settings.inputs.camera) {
        faceDetectionTimerRef.current = setTimeout(() => {
          // Check if camera is actually working by looking for video track
          const localTracks = tracks.filter(
            ({ participant }) => participant instanceof LocalParticipant
          );
          const videoTrack = localTracks.find(
            ({ source }) => source === Track.Source.Camera
          );
          
          // Only show warning if no video track found
          if (!videoTrack || !localParticipant?.isCameraEnabled) {
            setFaceDetectionWarning("Please ensure your face is visible on camera for the best interview experience.");
          }
        }, 12000);
      }

      // Start regular face capture every 20 seconds
      console.log(`🔄 Starting face capture every ${faceIntervalSeconds} seconds`);
      
      // Capture first face frame after 5 seconds (initial delay)
      faceIntervalRef.current = setTimeout(() => {
        captureFaceFrame();
        
        // Then set up regular interval captures
        visionAnalysisIntervalRef.current = setInterval(() => {
          captureFaceFrame();
        }, faceIntervalSeconds * 1000); // Convert seconds to milliseconds
      }, 5000); // Initial 5-second delay
    } else {
      // Clear all timers on disconnect
      console.log('⏹️ Stopping all face capture timers');
      
      if (faceDetectionTimerRef.current) {
        clearTimeout(faceDetectionTimerRef.current);
        faceDetectionTimerRef.current = null;
      }
      if (faceIntervalRef.current) {
        clearTimeout(faceIntervalRef.current);
        faceIntervalRef.current = null;
      }
      if (visionAnalysisIntervalRef.current) {
        clearInterval(visionAnalysisIntervalRef.current);
        visionAnalysisIntervalRef.current = null;
      }
      setFaceDetectionWarning(null);
      
      // Reset face capture count
      faceCaptureCountRef.current = 0;
    }

    return () => {
      if (faceDetectionTimerRef.current) clearTimeout(faceDetectionTimerRef.current);
      if (faceIntervalRef.current) clearTimeout(faceIntervalRef.current);
      if (visionAnalysisIntervalRef.current) clearInterval(visionAnalysisIntervalRef.current);
    };
  }, [config, localParticipant, roomState, captureFaceFrame, tracks, faceIntervalSeconds]);

  // Keep chatEnabled state in sync with config
  useEffect(() => {
    setChatEnabled(config.settings.chat);
  }, [config.settings.chat]);

  // Ref to track if 40s timer has been set (prevent multiple timers)
  const proctorFaceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const proctorFaceTimerSetRef = useRef<boolean>(false);
  // Ref to store latest tracks so we can access them in the timeout callback
  const tracksRef = useRef(tracks);
  
  // Update tracks ref whenever tracks change
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  // Ref to track which session the timer was set for
  const proctorFaceTimerSessionRef = useRef<string>('');

  // One-time proctoring face capture at ~40s after connection
  useEffect(() => {
    if (roomState !== ConnectionState.Connected || !sessionId) {
      // Clear timer if disconnected
      if (proctorFaceTimerRef.current) {
        clearTimeout(proctorFaceTimerRef.current);
        proctorFaceTimerRef.current = null;
        proctorFaceTimerSetRef.current = false;
        proctorFaceTimerSessionRef.current = '';
      }
      return;
    }

    // Reset timer flag if session changed
    if (proctorFaceTimerSessionRef.current !== sessionId) {
      proctorFaceTimerSetRef.current = false;
      proctorFaceTimerSessionRef.current = sessionId;
    }

    // Avoid duplicate capture for this session
    if (localStorage.getItem(`proctor_face_captured_${sessionId}`) === 'true') {
      console.log('📸 Proctoring: candidate snapshot already captured for this session');
      return;
    }

    // Only set timer once per session
    if (proctorFaceTimerSetRef.current) {
      return;
    }

    console.log('⏰ Proctoring: Setting 40s timer for candidate snapshot...');
    proctorFaceTimerSetRef.current = true;

    proctorFaceTimerRef.current = setTimeout(async () => {
      try {
        console.log('⏳ Proctoring: attempting candidate snapshot (~40s)');
        
        // Try to capture current face frame - wait a bit for tracks to be ready
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Use ref to get latest tracks (won't be stale)
        const localTracksNow = tracksRef.current.filter(({ participant }) => participant instanceof LocalParticipant);
        const camTrack = localTracksNow.find(({ source }) => source === Track.Source.Camera);
        
        if (!camTrack) {
          console.warn('⚠️ Proctoring: No camera track available for snapshot');
          return;
        }

        console.log('📸 Proctoring: Capturing face frame...');
        const faceFrame = await captureFrameFromTrack(camTrack);
        if (!faceFrame) {
          console.error('❌ Proctoring: Failed to capture face frame');
          return;
        }

        console.log('📤 Proctoring: Uploading candidate snapshot...');
        const resp = await fetch(apiUrl("/api/proctor/upload-candidate-face"), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, face_frame: faceFrame })
        });
        
        if (resp.ok) {
          const data = await resp.json();
          if (data?.success && data?.url) {
            localStorage.setItem(`proctor_face_url_${sessionId}`, data.url);
            localStorage.setItem(`proctor_face_captured_${sessionId}`, 'true');
            console.log('✅ Proctoring: candidate snapshot saved successfully!', data.url);
          } else {
            console.error('❌ Proctoring: Upload response missing success/url', data);
          }
        } else {
          console.error('❌ Proctoring: Upload failed with status', resp.status);
        }
      } catch (e) {
        console.error('❌ Proctoring face snapshot failed:', e);
      }
    }, 40000); // 40 seconds

    return () => {
      // Don't clear timer on dependency changes - only on unmount/disconnect
      // Timer will complete even if component re-renders
    };
  }, [roomState, sessionId]); // Removed 'tracks' from dependencies to prevent timer reset

  // Ref to track if tab switch counter has been initialized for this session
  const tabSwitchInitializedRef = useRef<string>('');

  // Tab switch counter (Page Visibility + window blur)
  useEffect(() => {
    if (!sessionId) return;

    const key = `proctor_tab_switch_count_${sessionId}`;
    const getCount = () => parseInt(localStorage.getItem(key) || '0', 10) || 0;
    const setCount = (n: number) => {
      localStorage.setItem(key, String(n));
      console.log(`📊 Tab switch count updated: ${n} (session: ${sessionId})`);
    };

    // Only reset counter once per session (when sessionId changes)
    if (tabSwitchInitializedRef.current !== sessionId) {
      console.log(`🔄 Initializing tab switch counter for session: ${sessionId}`);
      setCount(0);
      tabSwitchInitializedRef.current = sessionId;
    }

    // Count ONLY transitions to hidden to avoid double counting
    const lastHiddenRef = { current: document.hidden };
    const handleVisibilityChange = () => {
      const nowHidden = document.hidden;
      if (nowHidden && lastHiddenRef.current === false) {
        // Tab just became hidden - increment count
        const currentCount = getCount();
        const next = currentCount + 1;
        setCount(next);
        console.log(`👁️ Tab switch detected! Count: ${next}`);
      }
      lastHiddenRef.current = nowHidden;
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sessionId]);

  const agentVideoTrack = tracks.find(
    (trackRef) =>
      trackRef.publication.kind === Track.Kind.Video &&
      trackRef.participant.isAgent
  );

  const localTracks = tracks.filter(
    ({ participant }) => participant instanceof LocalParticipant
  );
  const localVideoTrack = localTracks.find(
    ({ source }) => source === Track.Source.Camera
  );
  const localMicTrack = localTracks.find(
    ({ source }) => source === Track.Source.Microphone
  );
  const localScreenTrack = localTracks.find(
    ({ source }) => source === Track.Source.ScreenShare
  );
  const screenSharePublication = localScreenTrack?.publication as TrackPublication | undefined;

  // Screen sharing enforcement removed - no longer using screen sharing
  /*
  // Enforce entire-screen sharing only & auto-sync flag when user stops
  useEffect(() => {
    if (!localParticipant) return;

    const track = screenSharePublication?.track;
    const mediaTrack: MediaStreamTrack | undefined =
      // publication?.track?.mediaStreamTrack for latest SDK
      (track as any)?.mediaStreamTrack ||
      (localScreenTrack as any)?.mediaStreamTrack ||
      undefined;

    if (!mediaTrack) {
      // If track disappeared but flag still true, disable to keep backend in sync
      if (localParticipant.isScreenShareEnabled) {
        console.warn("📺 Screen share flag true but no track. Forcing disable.");
        localParticipant
          .setScreenShareEnabled(false)
          .then(() => updateScreenStatusOnBackend(false, "track-missing"))
          .catch(console.error);
      }
      return;
    }

    const settings = mediaTrack.getSettings?.() as MediaTrackSettings | undefined;
    if (settings?.displaySurface && settings.displaySurface !== "monitor") {
      setScreenShareWarning(
        "Please share your ENTIRE SCREEN (not a window or browser tab). Click 'Share again' → choose 'Entire Screen'."
      );
      mediaTrack.stop();
      localParticipant
        .setScreenShareEnabled(false)
        .then(() => updateScreenStatusOnBackend(false, "invalid-surface"))
        .catch(console.error);
      return;
    }

    setScreenShareWarning(null);

    // If user started sharing via browser UI (without toggle), ensure flag is true
    if (!localParticipant.isScreenShareEnabled) {
      console.log("📺 Screen track detected but flag was false -> syncing to true");
      localParticipant
        .setScreenShareEnabled(true)
        .then(() => updateScreenStatusOnBackend(true, "track-detected"))
        .catch(console.error);
    }

    const handleEnded = () => {
      console.log("🛑 Screen sharing stopped (track ended) – updating status");
      localParticipant
        .setScreenShareEnabled(false)
        .then(() => updateScreenStatusOnBackend(false, "track-ended"))
        .catch(console.error);
    };

    mediaTrack.addEventListener?.("ended", handleEnded);
    return () => mediaTrack.removeEventListener?.("ended", handleEnded);
  }, [localParticipant, screenSharePublication]);
  */

  const onDataReceived = useCallback(
    (msg: any) => {
      if (msg.topic === "transcription") {
        const decoded = JSON.parse(
          new TextDecoder("utf-8").decode(msg.payload)
        );
        let timestamp = new Date().getTime();
        if ("timestamp" in decoded && decoded.timestamp > 0) {
          timestamp = decoded.timestamp;
        }
        setTranscripts([
          ...transcripts,
          {
            name: "You",
            message: decoded.text,
            timestamp: timestamp,
            isSelf: true,
          },
        ]);
      }
    },
    [transcripts]
  );

  useDataChannel(onDataReceived);

  // Trigger immediate code analysis when user says "done"/"completed"
  const triggerImmediateCodeAnalysis = useCallback(async () => {
    if (isAnalyzingCodeRef.current) {
      console.log('Analysis already in progress, skipping...');
      return;
    }
    
    if (!localScreenTrack) {
      console.log('No screen share active');
      return;
    }
    
    console.log('🎯 Code Analysis Triggered: User said "done"');
    
    isAnalyzingCodeRef.current = true;
    
    try {
      console.log('⏳ Waiting 2 seconds for final code to be visible...');
      
      // Wait for final code changes to be rendered
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('📸 Capturing FRESH screen frame for code analysis...');
      
      // Capture FRESH screen frame NOW (when user says "done")
      const screenFrame = await captureFrameFromTrack(localScreenTrack);
      if (!screenFrame) {
        console.error('❌ Failed to capture screen frame for code analysis');
        isAnalyzingCodeRef.current = false;
        return;
      }
      
      console.log('✅ Screen frame captured successfully');
      
      // Capture FRESH face frame NOW (optional, use latest if available)
      let faceFrame = latestFaceFrameRef.current;
      if (localVideoTrack) {
        console.log('📸 Capturing fresh face frame...');
        const freshFace = await captureFrameFromTrack(localVideoTrack);
        if (freshFace) {
          faceFrame = freshFace;
          console.log('✅ Fresh face frame captured');
        }
      }
      
      console.log('📤 Sending code analysis to backend...');
      
      // Send to backend for immediate analysis
      const response = await fetch(apiUrl("/api/analyze-code-immediate"), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          face_frame: faceFrame,
          screen_frame: screenFrame,
          problem_description: null
        })
      });
      
      // Also store a proctoring code snapshot image for results
      try {
        const codeUpload = await fetch(apiUrl("/api/proctor/upload-code-snapshot"), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, screen_frame: screenFrame })
        });
        if (codeUpload.ok) {
          const uploaded = await codeUpload.json();
          if (uploaded?.success && uploaded?.url) {
            localStorage.setItem(`proctor_code_url_${sessionId}`, uploaded.url);
            console.log('✅ Proctoring: code snapshot saved', uploaded.url);
          }
        }
      } catch (e) {
        console.warn('Code snapshot upload failed', e);
      }

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Code analysis sent successfully - AI will provide feedback');
      } else {
        console.error('❌ Immediate analysis failed:', response.status);
      }
    } catch (error) {
      console.error('Error during immediate analysis:', error);
    } finally {
      setTimeout(() => {
        isAnalyzingCodeRef.current = false;
      }, 5000);
    }
  }, [sessionId, localScreenTrack, localVideoTrack]);

  // Handle AI status check requests
  const handleStatusCheck = useCallback(async () => {
    if (!sessionId) return;
    
    console.log('🔍 AI Status Check: User asking about screen/camera');
    
    try {
      // If screen sharing is active, capture current screen content
      if (localScreenTrack) {
        console.log('⏳ Waiting 1.5 seconds for screen content to be ready...');
        
        // Wait a moment for screen content to be fully rendered
        // This is important if user just wrote code and immediately asked about it
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        console.log('📸 Capturing screen for status check...');
        const screenFrame = await captureFrameFromTrack(localScreenTrack);
        
        if (screenFrame) {
          console.log('✅ Screen captured for AI status verification');
          
          // Send to backend for immediate analysis
          const response = await fetch(apiUrl("/api/vision-analyze"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: sessionId,
              frame_data: screenFrame,
              frame_type: 'screen',
              timestamp: Date.now()
            })
          });
          
          if (!response.ok) {
            console.error('❌ Failed to send screen for analysis');
          } else {
            console.log('📤 Status check analysis sent to backend');
          }
        } else {
          console.error('❌ Failed to capture screen frame for status check');
        }
      } else {
        console.log('📺 No screen sharing active for status check');
      }
      
      // AI can now check real status via backend API
      
    } catch (error) {
      console.error('Error during status check:', error);
    }
  }, [sessionId, localScreenTrack]);

  const videoTileContent = useMemo(() => {
    const videoFitClassName = `object-${config.video_fit || "cover"}`;

    const disconnectedContent = (
      <div className="flex items-center justify-center text-gray-700 text-center w-full h-full">
        No video track. Connect to get started.
      </div>
    );

    const videoContent = (
      <VideoTrack
        trackRef={agentVideoTrack}
        className={`absolute top-1/2 -translate-y-1/2 ${videoFitClassName} object-position-center w-full h-full`}
      />
    );

    let content = null;
    if (roomState === ConnectionState.Disconnected) {
      content = disconnectedContent;
    } else if (agentVideoTrack) {
      content = videoContent;
    } else {
      content = disconnectedContent;
    }

    return (
      <div className="flex flex-col w-full grow text-gray-900 dark:text-gray-950/90 bg-white dark:bg-black rounded-sm border border-gray-200 dark:border-gray-800 relative">
        {content}
      </div>
    );
  }, [agentVideoTrack, config, roomState]);

  useEffect(() => {
    document.body.style.setProperty(
      "--lk-theme-color",
      // @ts-ignore
      tailwindTheme.colors[config.settings.theme_color]["500"]
    );
    document.body.style.setProperty(
      "--lk-drop-shadow",
      `var(--lk-theme-color) 0px 0px 18px`
    );
  }, [config.settings.theme_color]);

  const audioTileContent = useMemo(() => {
    const disconnectedContent = (
      <div className="flex flex-col items-center justify-center gap-2 text-gray-700 text-center w-full">
        No audio track. Connect to get started.
      </div>
    );

    const waitingContent = (
      <div className="flex flex-col items-center justify-center gap-2 text-gray-700 text-center w-full">
        <LoadingSVG />
        Waiting for interviewer
      </div>
    );

    const avatarContent = (
      <div className="flex items-center justify-center w-full h-full">
        <TalkingHeadAvatar
          audioTrackRef={isAvatarReady ? voiceAssistant.audioTrack : undefined}
          className="w-full h-full"
          onAvatarReady={() => {
            console.log("✅ Avatar ready - agent can now speak");
            setIsAvatarReady(true);
          }}
          onAvatarError={(error) => {
            console.error("❌ Avatar error:", error);
            setAvatarError(error);
          }}
        />
      </div>
    );

    if (roomState === ConnectionState.Disconnected) {
      return disconnectedContent;
    }

    // Always show avatar (it will handle its own loading state)
    return avatarContent;
  }, [
    voiceAssistant.audioTrack,
    config.settings.theme_color,
    roomState,
    voiceAssistant.state,
    isAvatarReady,
  ]);

  const userAudioTileContent = useMemo(() => {
    const disconnectedContent = (
      <div className="flex flex-col items-center justify-center gap-2 text-gray-700 text-center w-full">
        No audio track. Connect to get started.
      </div>
    );

    const waitingContent = (
      <div className="flex flex-col items-center justify-center gap-2 text-gray-700 text-center w-full h-full">
        <LoadingSVG />
        Waiting for microphone
      </div>
    );

    if (roomState === ConnectionState.Disconnected) {
      return disconnectedContent;
    }

    const hasCamera = localParticipant?.isCameraEnabled && localVideoTrack;
    const hasMic = localParticipant?.isMicrophoneEnabled && localMicTrack;
    const hasScreenShare = localParticipant?.isScreenShareEnabled && localScreenTrack;

    return (
      <div className="flex w-full h-full gap-4">
        {hasScreenShare && (
          <div className="w-full relative overflow-hidden rounded-sm border border-gray-800">
            <VideoTrack
              trackRef={localScreenTrack}
              className="w-full h-full object-contain"
            />
          </div>
        )}
        
        {!hasScreenShare && (
          <>
            {hasCamera && (
              <div className="w-3/5 relative overflow-hidden rounded-sm border border-gray-800">
                <VideoTrack
                  trackRef={localVideoTrack}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            
            {hasMic && (
              <div className={`flex items-center justify-center ${hasCamera ? 'w-2/5' : 'w-full'} h-full [--lk-va-bar-width:30px] [--lk-va-bar-gap:20px] [--lk-fg:var(--lk-theme-color)]`}>
                <BarVisualizer
                  trackRef={localMicTrack}
                  barCount={5}
                  options={{ minHeight: 20 }}
                />
              </div>
            )}
          </>
        )}
        
        {!hasCamera && !hasMic && !hasScreenShare && waitingContent}
      </div>
    );
  }, [
    localMicTrack,
    localVideoTrack,
    localScreenTrack,
    config.settings.theme_color,
    roomState,
    localParticipant?.isCameraEnabled,
    localParticipant?.isMicrophoneEnabled,
    localParticipant?.isScreenShareEnabled
  ]);

  const chatTileContent = useMemo(() => {
    if (voiceAssistant.agent) {
      return (
        <TranscriptionTile
          agentAudioTrack={voiceAssistant.audioTrack}
          accentColor={config.settings.theme_color}
          onTranscriptsUpdate={setAllTranscripts}
          externalMessage={externalChatMessage}
          onExternalMessageConsumed={() => setExternalChatMessage(null)}
        />
      );
    }
    return <></>;
  }, [config.settings.theme_color, voiceAssistant.audioTrack, voiceAssistant.agent, externalChatMessage]);

  // Monitor transcripts for AI status requests
  // NOTE: "done" keyword detection removed - now handled by backend via OCR extraction flow
  useEffect(() => {
    if (allTranscripts.length === 0) return;
    
    // Get the last user message
    const lastUserMessage = [...allTranscripts]
      .reverse()
      .find(t => t.isSelf);
    
    if (!lastUserMessage) return;
    
    const message = lastUserMessage.message.toLowerCase();
    
    // Check for status check requests (user asks "can you see...")
    const statusCheckKeywords = [
      'can you see my screen',
      'can you see my camera', 
      'can you see my code',
      'can you see the editor',
      'are you able to see',
      'do you see my screen',
      'what do you see',
      'look at my code',
      'see my editor',
      'check my screen'
    ];
    
    const hasStatusRequest = statusCheckKeywords.some(keyword => 
      message.includes(keyword)
    );
    
    if (hasStatusRequest && !isAnalyzingCodeRef.current) {
      // User asking about status - requesting immediate screen analysis
      handleStatusCheck();
    }
    
  }, [allTranscripts, handleStatusCheck]);

  // Poll for AI screenshot requests - This enables dynamic screenshots!
  useEffect(() => {
    if (!sessionId || roomState !== ConnectionState.Connected) return;
    
    const pollForAIScreenshotRequests = async () => {
      try {
        const response = await fetch(apiUrl(`/api/screenshot-requests/${sessionId}`), {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.has_request) {
            console.log('🎯 AI REQUESTED FRESH SCREENSHOT - Capturing now...');
            
            // Wait 1 second for any UI changes to render, then capture
            setTimeout(async () => {
              if (localScreenTrack) {
                console.log('📸 Taking fresh screenshot for AI dynamic request...');
                
                // Capture fresh screenshot
                const screenFrame = await captureFrameFromTrack(localScreenTrack);
                if (screenFrame) {
                  console.log('✅ Fresh screenshot captured for AI');
                  
                  // Send to backend immediately
                  await fetch(apiUrl("/api/vision-analyze"), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      session_id: sessionId,
                      frame_data: screenFrame,
                      frame_type: 'screen',
                      timestamp: Date.now()
                    })
                  });
                  
                  console.log('📤 Fresh screenshot sent to AI - Dynamic capture complete!');
                } else {
                  console.error('❌ Failed to capture fresh screenshot for AI request');
                }
              } else {
                console.log('📺 No screen sharing active - cannot fulfill AI screenshot request');
              }
            }, 1000);
          }
        }
      } catch (error) {
        // Silently handle polling errors to avoid console spam
      }
    };
    
    console.log('🔄 Starting AI screenshot request polling...');
    
    // Poll every 3 seconds for AI screenshot requests
    const pollInterval = setInterval(pollForAIScreenshotRequests, 3000);
    
    return () => {
      clearInterval(pollInterval);
      console.log('⏹️ Stopped AI screenshot request polling');
    };
  }, [sessionId, roomState, localScreenTrack]);

  // Code Editor Handlers
  const handleCodeEditorOpen = useCallback(() => {
    setIsCodeEditorOpen(true);
  }, []);

  const handleCodeEditorClose = useCallback(() => {
    setIsCodeEditorOpen(false);
  }, []);

  const handleCodeSubmit = useCallback((code: string, language: string) => {
    console.log('📝 Code submitted from editor:');
    console.log(`   Language: ${language}`);
    console.log(`   Code length: ${code.length} characters`);
    
    // Format the code message for AI
    const codeMessage = `I've written the following ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``;
    
    // Inject the code into the chat input field
    setExternalChatMessage(codeMessage);
    
    console.log('✅ Code injected into chat input - will auto-send in 500ms');
  }, []);

  const handleEndCall = useCallback(async () => {
    console.log('🛑 END CALL - Stopping all capture intervals and timers');
    
    // Stop recording if active
    if (recording.isRecording) {
      console.log('🛑 Stopping recording...');
      await recording.stopRecording();
    }
    
    // Store session ID for results page
    if (sessionId) {
      localStorage.setItem("lastInterviewSessionId", sessionId);
      // DON'T clear tab switch count here - we want to keep it for results page
      // The count will be reset when a new session starts (via tabSwitchInitializedRef)
      console.log(`📊 Final tab switch count for session ${sessionId}:`, 
        localStorage.getItem(`proctor_tab_switch_count_${sessionId}`));
    }
    
    // Clear ALL timers and intervals immediately
    if (proctorFaceTimerRef.current) {
      clearTimeout(proctorFaceTimerRef.current);
      proctorFaceTimerRef.current = null;
      proctorFaceTimerSetRef.current = false;
    }
    
    if (faceDetectionTimerRef.current) {
      clearTimeout(faceDetectionTimerRef.current);
      faceDetectionTimerRef.current = null;
    }
    
    if (faceIntervalRef.current) {
      clearTimeout(faceIntervalRef.current);
      faceIntervalRef.current = null;
    }
    
    if (visionAnalysisIntervalRef.current) {
      clearInterval(visionAnalysisIntervalRef.current);
      visionAnalysisIntervalRef.current = null;
    }
    
    console.log('✅ All timers and intervals cleared');
    
    if (onEndCall) {
      onEndCall(allTranscripts);
    }
    onConnect(false);
  }, [onEndCall, allTranscripts, onConnect, sessionId, recording]);

  // Clear backend and frontend session data ONLY on actual tab/window close
  // DO NOT cleanup on component unmount (navigating to results) - data needs to persist!
  useEffect(() => {
    if (!sessionId) return;

    const cleanup = async () => {
      try {
        console.log('🧹 Cleanup triggered - deleting session data from backend');
        // Clear backend vision analysis and proctoring for this session
        await fetch(apiUrl(`/api/vision-analysis/${sessionId}`), { method: "DELETE" });
        await fetch(apiUrl(`/api/proctor/${sessionId}`), { method: "DELETE" });
      } catch {}
      // Clear localStorage keys for this session
      localStorage.removeItem(`proctor_face_url_${sessionId}`);
      localStorage.removeItem(`proctor_code_url_${sessionId}`);
      localStorage.removeItem(`proctor_tab_switch_count_${sessionId}`);
      localStorage.removeItem(`proctor_face_captured_${sessionId}`);
    };

    const handleBeforeUnload = () => {
      // ONLY cleanup on actual tab/window close, NOT on page navigation
      // This allows data to persist when user views results page
      cleanup();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // REMOVED cleanup() call here - don't cleanup on component unmount!
      // This ensures data persists when navigating to results page
    };
  }, [sessionId]);

  const handleRpcCall = useCallback(async () => {
    if (!voiceAssistant.agent || !room) return;
    
    try {
      const response = await room.localParticipant.performRpc({
        destinationIdentity: voiceAssistant.agent.identity,
        method: rpcMethod,
        payload: rpcPayload,
      });
      console.log('RPC response:', response);
    } catch (e) {
      console.error('RPC call failed:', e);
    }
  }, [room, rpcMethod, rpcPayload, voiceAssistant.agent]);

  let mobileTabs: PlaygroundTab[] = [];
  
  mobileTabs.push({
    title: "Interviewer",
    content: (
      <PlaygroundTile
        className="w-full h-full grow"
        childrenClassName="justify-center"
      >
        {audioTileContent}
      </PlaygroundTile>
    ),
  });

  mobileTabs.push({
    title: "You",
    content: (
      <PlaygroundTile
        className="w-full h-full grow"
        childrenClassName="justify-center"
      >
        {userAudioTileContent}
      </PlaygroundTile>
    ),
  });

  if (config.settings.chat && chatEnabled) {
    mobileTabs.push({
      title: "Chat",
      content: chatTileContent,
    });
  }

  return (
    <>
      <PlaygroundHeader
        title={config.title}
        logo={logo}
        githubLink={config.github_link}
        height={headerHeight}
        accentColor={config.settings.theme_color}
        connectionState={roomState}
        onConnectClicked={() =>
          onConnect(roomState === ConnectionState.Disconnected)
        }
        onChatToggle={() => setChatEnabled(!chatEnabled)}
        onEndCall={handleEndCall}
        onCodeEditorOpen={handleCodeEditorOpen}
      />
      
      {/* Code Editor Modal */}
      <CodeEditorModal
        isOpen={isCodeEditorOpen}
        onClose={handleCodeEditorClose}
        onSubmit={handleCodeSubmit}
        sessionId={sessionId}
        accentColor={config.settings.theme_color}
      />
      
      {/* Screen share warning - Removed (no longer using screen sharing)
      {screenShareWarning && (
        <div className="fixed z-50 left-1/2 top-6 -translate-x-1/2 w-[90%] max-w-xl">
          <div className="bg-amber-50 border border-amber-200 text-amber-900 dark:bg-amber-900/90 dark:border-amber-700 dark:text-white rounded-xl shadow-lg px-5 py-3 flex items-start gap-3">
            <div className="text-xl">⚠️</div>
            <div className="flex-1 text-sm md:text-base leading-relaxed">
              {screenShareWarning}
            </div>
            <button
              onClick={() => setScreenShareWarning(null)}
              className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-200 hover:underline"
            >
              Got it
            </button>
          </div>
        </div>
      )}
      */}
      
      {/* Face Detection Warning */}
      {faceDetectionWarning && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 animate-pulse">
          <div className="bg-yellow-500 text-black px-6 py-3 rounded-lg shadow-lg flex items-center gap-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="font-medium">{faceDetectionWarning}</span>
            <button 
              onClick={() => setFaceDetectionWarning(null)}
              className="ml-2 hover:text-gray-700"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      
      <div
        className={`flex gap-4 py-4 grow w-full selection:bg-${config.settings.theme_color}-900 overflow-hidden`}
        style={{ height: `calc(100% - ${headerHeight}px)` }}
      >
        {/* Mobile View */}
        <div className="flex flex-col w-full h-full lg:hidden">
          <PlaygroundTabbedTile
            className="h-[calc(100%-2rem)]"
            tabs={mobileTabs}
            initialTab={0}
          />
        </div>

        {/* Desktop View */}
        <div className="hidden lg:flex w-full h-full gap-4 flex-1">
          <div className={`flex ${!chatEnabled ? 'flex-row w-full' : 'flex-col w-[70%]'} gap-4 min-w-[320px] h-full`}>
            <PlaygroundTile
              title="Interviewer"
              className={!chatEnabled ? 'w-[30%]' : 'h-1/2'}
              childrenClassName="justify-center h-full"
            >
              {audioTileContent}
            </PlaygroundTile>
            <PlaygroundTile
              title="You"
              className={!chatEnabled ? 'w-[70%]' : 'h-1/2'}
              childrenClassName="justify-center h-full"
            >
              {userAudioTileContent}
            </PlaygroundTile>
          </div>

          {config.settings.chat && chatEnabled && (
            <PlaygroundTile
              title="Chat"
              className="w-[30%] min-w-[240px] h-full"
            >
              {chatTileContent}
            </PlaygroundTile>
          )}
        </div>
      </div>
    </>
  );
}
