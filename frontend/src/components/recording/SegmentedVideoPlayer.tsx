/**
 * Segmented Video Player Component
 * 
 * Udemy-style video player with:
 * - Phase-based segments (Introduction, Technical, Coding, Behavioral)
 * - Clickable segment navigation
 * - Transcript sync with video playback
 * - Download and sharing options
 */

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { BACKEND_URL } from "@/config";

interface Segment {
  index: number;
  phase: string;
  phase_name: string;
  start_time: number;
  end_time: number;
  duration: number;
  file_path: string;
  file_name: string;
}

interface TranscriptEntry {
  name: string;
  message: string;
  timestamp: number;
  is_self: boolean;
}

interface SegmentedVideoPlayerProps {
  sessionId: string;
  segments: Segment[];
  transcripts: TranscriptEntry[];
  metadata?: any;
}

export function SegmentedVideoPlayer({
  sessionId,
  segments,
  transcripts,
  metadata,
}: SegmentedVideoPlayerProps) {
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [highlightedTranscriptIndex, setHighlightedTranscriptIndex] = useState<number | null>(null);

  const currentSegment = segments[currentSegmentIndex];
  const videoUrl = currentSegment
    ? `${BACKEND_URL}/recordings/${sessionId}/segments/${currentSegment.file_name}`
    : null;

  // Filter transcripts for current segment
  const segmentTranscripts = transcripts.filter((t) => {
    const segmentStart = currentSegment?.start_time || 0;
    const segmentEnd = currentSegment?.end_time || Infinity;
    // Convert timestamp to seconds (assuming timestamp is in milliseconds)
    const transcriptTime = t.timestamp / 1000;
    return transcriptTime >= segmentStart && transcriptTime <= segmentEnd;
  });

  // Update current time
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateTime = () => {
      setCurrentTime(video.currentTime);
      
      // Highlight transcript entry based on current time
      const absoluteTime = (currentSegment?.start_time || 0) + video.currentTime;
      const transcriptIndex = segmentTranscripts.findIndex((t) => {
        const transcriptTime = t.timestamp / 1000;
        return transcriptTime >= absoluteTime - 2 && transcriptTime <= absoluteTime + 2;
      });
      
      setHighlightedTranscriptIndex(transcriptIndex >= 0 ? transcriptIndex : null);
    };

    video.addEventListener("timeupdate", updateTime);
    return () => video.removeEventListener("timeupdate", updateTime);
  }, [currentSegment, segmentTranscripts]);

  // Handle play/pause
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
    setIsPlaying(!isPlaying);
  };

  // Handle segment change
  const changeSegment = (index: number) => {
    setCurrentSegmentIndex(index);
    setIsPlaying(false);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  };

  // Filter segments by phase
  const filteredSegments = selectedPhase
    ? segments.filter((s) => s.phase === selectedPhase)
    : segments;

  // Phase colors
  const phaseColors: Record<string, string> = {
    introduction: "bg-blue-500",
    technical: "bg-purple-500",
    coding: "bg-green-500",
    behavioral: "bg-orange-500",
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Interview Recording
        </h2>
        <button
          onClick={() => {
            const link = document.createElement("a");
            link.href = `${BACKEND_URL}/recordings/${sessionId}/metadata.json`;
            link.download = `interview_${sessionId}_metadata.json`;
            link.click();
          }}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm"
        >
          Download Metadata
        </button>
      </div>

      {/* Main layout - Udemy style: video left, segments right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: video + controls + transcript */}
        <div className="lg:col-span-2 space-y-4">
          {/* Video Player */}
          <div className="bg-black rounded-xl overflow-hidden shadow-lg">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-auto"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => {
                  if (currentSegmentIndex < segments.length - 1) {
                    changeSegment(currentSegmentIndex + 1);
                  }
                }}
                controls
              />
            ) : (
              <div className="aspect-video flex items-center justify-center text-white">
                No video available
              </div>
            )}
          </div>

          {/* Controls + current segment info */}
          <div className="flex items-center gap-4 bg-white dark:bg-gray-900 rounded-xl px-4 py-3 shadow-sm border border-gray-200 dark:border-gray-800">
            <button
              onClick={togglePlay}
              className="px-5 py-2.5 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors font-medium text-sm"
            >
              {isPlaying ? "⏸ Pause" : "▶ Play"}
            </button>
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                Segment {currentSegmentIndex + 1} of {segments.length}:{" "}
                {currentSegment?.phase_name}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {Math.floor(currentTime)}s /{" "}
                {Math.floor(currentSegment?.duration || 0)}s
              </div>
            </div>
          </div>

          {/* Transcript Panel */}
          <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 shadow-sm">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
              Transcript - {currentSegment?.phase_name}
            </h3>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {segmentTranscripts.length > 0 ? (
                segmentTranscripts.map((transcript, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded-lg transition-colors text-sm ${
                      highlightedTranscriptIndex === index
                        ? "bg-cyan-100 dark:bg-cyan-900/30 border-l-4 border-cyan-500"
                        : "bg-gray-50 dark:bg-gray-900/40"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-800 dark:text-gray-200">
                        {transcript.name}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(transcript.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-gray-900 dark:text-white">
                      {transcript.message}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  No transcript available for this segment.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right: phase filter + segments list */}
        <div className="space-y-4">
          {/* Phase Filter */}
          <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 shadow-sm">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 text-sm">
              Segment Categories
            </h3>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setSelectedPhase(null)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  selectedPhase === null
                    ? "bg-cyan-500 text-white"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                }`}
              >
                All
              </button>
              {Array.from(new Set(segments.map((s) => s.phase))).map((phase) => (
                <button
                  key={phase}
                  onClick={() => setSelectedPhase(phase)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-2 ${
                    selectedPhase === phase
                      ? "bg-cyan-500 text-white"
                      : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${phaseColors[phase] || "bg-gray-500"}`}
                  />
                  {segments.find((s) => s.phase === phase)?.phase_name || phase}
                </button>
              ))}
            </div>
          </div>

          {/* Segments List */}
          <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 shadow-sm max-h-[540px] overflow-y-auto">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 text-sm">
              Course Content ({filteredSegments.length} videos)
            </h3>
            <div className="space-y-2">
              {filteredSegments.map((segment) => {
                const actualIndex = segments.indexOf(segment);
                const isActive = actualIndex === currentSegmentIndex;

                return (
                  <motion.button
                    key={segment.index}
                    onClick={() => changeSegment(actualIndex)}
                    className={`w-full text-left p-3 rounded-lg border text-sm transition-all flex flex-col gap-1 ${
                      isActive
                        ? "border-cyan-500 bg-cyan-50 dark:bg-cyan-900/30"
                        : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-cyan-300"
                    }`}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${phaseColors[segment.phase] || "bg-gray-500"}`}
                        />
                        <span className="font-medium text-gray-900 dark:text-white">
                          {segment.phase_name}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {Math.round(segment.duration)}s
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {Math.floor(segment.start_time)}s –{" "}
                      {Math.floor(segment.end_time)}s
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

