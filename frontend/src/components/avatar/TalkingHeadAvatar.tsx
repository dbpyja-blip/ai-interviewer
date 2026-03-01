"use client";

import React, { useEffect, useRef, useState } from "react";
import type { TrackReference } from "@livekit/components-core";
import { LoadingSVG } from "@/components/button/LoadingSVG";

interface TalkingHeadAvatarProps {
  audioTrackRef?: TrackReference;
  className?: string;
  onAvatarReady?: () => void;
  onAvatarError?: (error: string) => void;
}

export const TalkingHeadAvatar: React.FC<TalkingHeadAvatarProps> = ({
  audioTrackRef,
  className = "",
  onAvatarReady,
  onAvatarError,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);

  // Initialize avatar
  useEffect(() => {
    if (!containerRef.current || isInitializedRef.current) return;
    isInitializedRef.current = true;

    const initAvatar = async () => {
      try {
        console.log("🎭 Initializing avatar...");
        setLoadingProgress("Loading avatar library...");

        // Wait for TalkingHead to be loaded by the global script
        let attempts = 0;
        while (!(window as any).TalkingHead && attempts < 100) {
          console.log(`⏳ Waiting for TalkingHead... attempt ${attempts + 1}`);
          await new Promise(resolve => setTimeout(resolve, 200));
          attempts++;
        }

        if (!(window as any).TalkingHead) {
          throw new Error("TalkingHead not loaded after 20 seconds. Check browser console for import errors.");
        }

        const TalkingHead = (window as any).TalkingHead;
        
        console.log("✅ TalkingHead library loaded");
        setLoadingProgress("Creating avatar instance...");

        // Create TalkingHead instance
        const head = new TalkingHead(containerRef.current, {
          cameraView: "upper",
          cameraDistance: 0.58,
          cameraY: 0.0,
          avatarMood: "neutral",
        });

        headRef.current = head;
        console.log("✅ Avatar instance created");
        setLoadingProgress("Loading 3D model...");

        // Load a Ready Player Me avatar with proper morphTargets
        await head.showAvatar({
          url: "https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb?morphTargets=ARKit,Oculus+Visemes,mouthOpen,mouthSmile,eyesClosed,eyesLookUp,eyesLookDown&textureSizeLimit=1024&textureFormat=png",
          body: "F",
          avatarMood: "neutral",
          lipsyncLang: "en",
        });

        console.log("✅ Avatar loaded successfully");
        setLoadingProgress("Avatar ready!");
        setIsLoading(false);
        
        // Notify parent that avatar is ready
        if (onAvatarReady) {
          onAvatarReady();
        }
      } catch (err: any) {
        console.error("❌ Failed to initialize avatar:", err);
        const errorMsg = err?.message || "Failed to load avatar";
        setError(errorMsg);
        setIsLoading(false);
        
        // Notify parent of error
        if (onAvatarError) {
          onAvatarError(errorMsg);
        }
      }
    };

    initAvatar();

    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
      }
    };
  }, [onAvatarReady, onAvatarError]);

  // Connect to LiveKit audio track and animate avatar based on audio
  useEffect(() => {
    if (!audioTrackRef?.publication?.track || !headRef.current || isLoading) {
      return;
    }

    const track = audioTrackRef.publication.track as any;
    const mediaStreamTrack = track.mediaStreamTrack;

    if (!mediaStreamTrack) {
      console.warn("No media stream track available");
      return;
    }

    console.log("🎤 Connecting audio track to avatar...");

    try {
      // Create audio context
      audioContextRef.current = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      const audioContext = audioContextRef.current;

      // Create media stream from track
      const stream = new MediaStream([mediaStreamTrack]);
      sourceNodeRef.current = audioContext.createMediaStreamSource(stream);

      // Create analyser for volume detection
      analyserRef.current = audioContext.createAnalyser();
      analyserRef.current.fftSize = 256;
      sourceNodeRef.current.connect(analyserRef.current);

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);

      // Animate avatar mouth based on audio volume
      const animate = () => {
        if (!analyserRef.current || !headRef.current) return;

        analyserRef.current.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        
        // Normalize volume (0-1 range)
        const normalizedVolume = Math.min(average / 128, 1);

        // Animate mouth opening based on volume
        if (normalizedVolume > 0.05) {
          // Speaking - open mouth
          try {
            headRef.current.setFixedValue("jawOpen", normalizedVolume * 0.6);
            headRef.current.setFixedValue("mouthOpen", normalizedVolume * 0.4);
          } catch (e) {
            // Ignore errors if methods not available
          }
        } else {
          // Not speaking - close mouth
          try {
            headRef.current.setFixedValue("jawOpen", null);
            headRef.current.setFixedValue("mouthOpen", null);
          } catch (e) {
            // Ignore errors
          }
        }

        animationFrameRef.current = requestAnimationFrame(animate);
      };

      animate();

      console.log("✅ Audio connected to avatar");
    } catch (err) {
      console.error("Failed to connect audio:", err);
    }

    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect();
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(console.error);
      }
    };
  }, [audioTrackRef, isLoading]);

  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      {/* Avatar container */}
      <div
        ref={containerRef}
        className="w-full h-full absolute inset-0"
        style={{ 
          minHeight: "100%",
          width: "100%",
          height: "100%"
        }}
      />
      
      {/* Loading overlay */}
      {isLoading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white dark:bg-black bg-opacity-95 dark:bg-opacity-95 z-10">
          <LoadingSVG />
          <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">
            {loadingProgress}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 max-w-xs text-center">
            Please wait while we prepare your interviewer avatar...
          </p>
        </div>
      )}
      
      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white dark:bg-black bg-opacity-95 dark:bg-opacity-95 z-10">
          <div className="text-red-500 text-4xl">⚠️</div>
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">
            Failed to load avatar
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400 max-w-xs text-center">
            {error}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
          >
            Reload Page
          </button>
        </div>
      )}
    </div>
  );
};
