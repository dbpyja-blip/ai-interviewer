import { useRouter } from "next/router";
import Head from "next/head";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SegmentedVideoPlayer } from "@/components/recording/SegmentedVideoPlayer";
import { apiUrl, BACKEND_URL } from "@/config";

type RecordingMetadata = {
  session_id: string;
  segments: any[];
  transcripts: any[];
  total_segments: number;
  total_duration: number;
};

export default function AnalysisPage() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string>("");
  const [metadata, setMetadata] = useState<RecordingMetadata | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Load session id and metadata
  useEffect(() => {
    const querySessionId = (router.query.sessionId as string) || "";
    const storedSessionId = typeof window !== "undefined"
      ? localStorage.getItem("lastInterviewSessionId") || ""
      : "";

    const effectiveSessionId = querySessionId || storedSessionId;

    if (!effectiveSessionId) {
      setError("No session id found for this analysis.");
      setLoading(false);
      return;
    }

    setSessionId(effectiveSessionId);

    const fetchMetadata = async () => {
      try {
        const resp = await fetch(
          apiUrl(`/api/recording/metadata/${effectiveSessionId}`)
        );

        if (!resp.ok) {
          setError("Recording metadata not available for this session.");
          setLoading(false);
          return;
        }

        const json = await resp.json();
        if (!json.success || !json.metadata) {
          setError("Recording metadata not available for this session.");
          setLoading(false);
          return;
        }

        setMetadata(json.metadata as RecordingMetadata);
      } catch (e) {
        console.error("Failed to load recording metadata for analysis page:", e);
        setError("Failed to load recording metadata.");
      } finally {
        setLoading(false);
      }
    };

    fetchMetadata();
  }, [router.query]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-300">
            Loading interview segments...
          </p>
        </div>
      </div>
    );
  }

  if (error || !metadata || !metadata.segments || metadata.segments.length === 0) {
    return (
      <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Segments Not Available
          </h1>
          <p className="text-gray-600 dark:text-gray-300">{error}</p>
          <button
            onClick={() => router.push("/results")}
            className="px-6 py-3 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors"
          >
            Back to Analysis
          </button>
        </div>
      </div>
    );
  }

  // Construct full recording URL (served by backend recordings static route)
  const fullRecordingUrl =
    sessionId && typeof window !== "undefined"
      ? `${BACKEND_URL}/recordings/${sessionId}/full_recording_${sessionId}.webm`
      : "";

  return (
    <>
      <Head>
        <title>Interview Segments — SkillCef AI Interviewer</title>
        <meta
          name="description"
          content="Replay your interview in structured segments — SkillCef AI Interviewer."
        />
        <link rel="icon" type="image/svg+xml" href="/skillcef-icon.svg" />
      </Head>

      <div className="min-h-screen bg-white dark:bg-black text-gray-900 dark:text-white">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          >
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-cyan-500">
                Interview Segments
              </h1>
              <p className="text-gray-600 dark:text-gray-300 mt-1">
                Watch the full recording or jump directly to specific topics,
                just like a professional course player.
              </p>
            </div>
            <button
              onClick={() => router.push("/results")}
              className="self-start md:self-auto px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              ← Back to Interview Analysis
            </button>
          </motion.div>

          {/* Full Recording Player - complete interview in one video */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="mb-6 bg-black rounded-2xl overflow-hidden shadow-lg border border-gray-900/50"
          >
            {fullRecordingUrl ? (
              <video
                src={fullRecordingUrl}
                controls
                className="w-full h-auto"
              />
            ) : (
              <div className="aspect-video flex items-center justify-center text-white text-sm">
                Full recording not available for this session.
              </div>
            )}
          </motion.div>

          {/* Segmented Udemy-style player */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-gray-50 dark:bg-gray-900 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-800"
          >
            <SegmentedVideoPlayer
              sessionId={sessionId}
              segments={metadata.segments}
              transcripts={metadata.transcripts || []}
              metadata={metadata}
            />
          </motion.div>
        </div>
      </div>
    </>
  );
}


