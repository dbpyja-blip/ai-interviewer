import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
} from "@livekit/components-react";
import { AnimatePresence, motion } from "framer-motion";
import { Inter } from "next/font/google";
import Head from "next/head";
import { useCallback, useState, useEffect, useMemo, useRef } from "react";

import { PlaygroundConnect } from "@/components/PlaygroundConnect";
import { WelcomePage } from "@/components/WelcomePage";
import Playground from "@/components/playground/Playground";
import { PlaygroundToast, ToastType } from "@/components/toast/PlaygroundToast";
import { ConfigProvider, useConfig } from "@/hooks/useConfig";
import { ConnectionMode, ConnectionProvider, useConnection } from "@/hooks/useConnection";
import { ToastProvider, useToast } from "@/components/toast/ToasterProvider";
import { ChatMessageType } from "@/components/chat/ChatTile";
import { useRouter } from "next/router";
import { apiUrl } from "@/config";

const themeColors = [
  "cyan",
  "green",
  "amber",
  "blue",
  "violet",
  "rose",
  "pink",
  "teal",
];

const inter = Inter({ subsets: ["latin"] });

export default function Home() {
  return (
    <ToastProvider>
      <ConfigProvider>
        <ConnectionProvider>
          <HomeInner />
        </ConnectionProvider>
      </ConfigProvider>
    </ToastProvider>
  );
}

export function HomeInner() {
  const { shouldConnect, wsUrl, token, mode, connect, disconnect } = useConnection();
  const {config} = useConfig();
  const { toastMessage, setToastMessage } = useToast();
  const userDisconnectedRef = useRef(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [hasStarted, setHasStarted] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const router = useRouter();

  // On every fresh page load wipe any stale session data from a previous interview.
  // This guarantees that even if the user just closes the tab and reopens it,
  // they will always start with a blank slate — no old session ID, no old candidate
  // data, no old proctoring cache.  The new session ID will be created by
  // InterviewForm when the user clicks "Start Interview".
  useEffect(() => {
    // Remove core session keys
    localStorage.removeItem("currentSessionId");
    localStorage.removeItem("currentCandidateData");
    localStorage.removeItem("currentResumeData");

    // Remove all per-session proctoring and transcript keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith("proctor_") || key.startsWith("interview_transcripts_"))
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));

    console.log(`🧹 Page loaded — cleared stale session data (${keysToRemove.length} extra keys removed)`);
  }, []); // empty deps = run once on mount only

  const handleConnect = useCallback(
    (c: boolean, mode: ConnectionMode = "manual") => {
      if (c) {
        userDisconnectedRef.current = false;
        connect(mode);
      } else {
        userDisconnectedRef.current = true;
        disconnect();
      }
    },
    [connect, disconnect]
  );

  const handleStartInterview = useCallback((formData?: any) => {
    console.log("Form submitted with data:", formData); // Log form data for now
    setShowWelcome(false);
    setHasStarted(true);
    // Start the connection when user submits form
    if (process.env.NEXT_PUBLIC_LIVEKIT_URL) {
      handleConnect(true, "env");
    }
  }, [handleConnect]);

  const handleEndCall = useCallback(async (transcripts: ChatMessageType[]) => {
    console.log('🛑🛑🛑 handleEndCall CALLED in index.tsx');
    console.log(`   Transcript count: ${transcripts?.length || 0}`);
    
    setIsAnalyzing(true);
    
    try {
      // Validate transcripts are not empty
      if (!transcripts || transcripts.length === 0) {
        console.error('No transcript data available for analysis');
        setToastMessage({ 
          message: "Cannot generate report: No interview transcript found. Please ensure you had a conversation during the interview.", 
          type: "error" 
        });
        setIsAnalyzing(false);
        return;
      }

      // Get candidate data from localStorage (stored during form submission)
      const candidateDataStr = localStorage.getItem("currentCandidateData");
      let candidateData = null;
      if (candidateDataStr) {
        try {
          candidateData = JSON.parse(candidateDataStr);
        } catch (e) {
          console.warn("Failed to parse candidate data from localStorage");
        }
      }

      // Get resume data from localStorage if available
      const resumeDataStr = localStorage.getItem("currentResumeData");
      let resumeData = null;
      if (resumeDataStr) {
        try {
          resumeData = JSON.parse(resumeDataStr);
        } catch (e) {
          console.warn("Failed to parse resume data from localStorage");
        }
      }

      // Get session ID from candidate data or generate one
      const sessionId = candidateData?.session_id || localStorage.getItem("lastInterviewSessionId");

      // Send analysis request to backend
      const analysisRequest = {
        session_id: sessionId,
        transcript: transcripts,
        candidate: candidateData,
        resume: resumeData,
        role: candidateData?.position || "Unknown"
      };

      console.log(`📤 Sending analysis request: ${transcripts.length} transcript messages`);

      const response = await fetch(apiUrl("/api/analyze"), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(analysisRequest),
      });

      if (response.ok) {
        const analysisResult = await response.json();
        
        console.log('✅ Analysis received:', {
          markdownLength: analysisResult.markdown?.length,
          overallScore: analysisResult.summary?.overallScore,
          strengths: analysisResult.summary?.strengths?.length
        });
        
        // Store analysis in localStorage — the results page always reads from here.
        // We deliberately do NOT put the data in the URL: it would make the address
        // bar hundreds of characters long and expose the full analysis to anyone
        // who glances at the screen or copies the link.
        localStorage.setItem("interviewAnalysis", JSON.stringify(analysisResult));
        
        // Store transcripts in localStorage for conversation tracking on results page
        const sessionId = candidateData?.session_id || localStorage.getItem("currentSessionId");
        if (sessionId && transcripts && transcripts.length > 0) {
          localStorage.setItem(`interview_transcripts_${sessionId}`, JSON.stringify(transcripts));
          console.log(`💾 Stored ${transcripts.length} transcripts for session ${sessionId}`);
        }
        
        // Navigate to the results page with a clean, short URL — no data in query params.
        router.push('/results');
      } else {
        // Try to get error message from response
        let errorMessage = `Analysis failed: ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData.detail) {
            errorMessage = errorData.detail;
          }
        } catch (e) {
          // If response is not JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        
        console.error('❌ Analysis failed:', errorMessage);
        setToastMessage({ 
          message: errorMessage || "Failed to analyze interview. Please try again.", 
          type: "error" 
        });
      }
    } catch (error: any) {
      console.error('Failed to analyze interview:', error);
      setToastMessage({ 
        message: error.message || "Failed to analyze interview. Please try again.", 
        type: "error" 
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [router, setToastMessage]);

  // Simplified showPG check - always show if env variable exists
  const showPG = Boolean(process.env.NEXT_PUBLIC_LIVEKIT_URL);

  return (
    <>
      <Head>
        <title>SkillCef AI Interviewer</title>
        <meta name="description" content="Practice your interviews with the SkillCef AI Interviewer — personalised, real-time mock interview experience." />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        {/* Use the SkillCef SVG as the browser tab icon — replaces the default Vercel favicon */}
        <link rel="icon" type="image/svg+xml" href="/skillcef-icon.svg" />
      </Head>
      <main className={`flex flex-col h-full w-full ${inter.className} bg-white text-gray-900 dark:bg-black dark:text-white`}>
        <AnimatePresence>
          {toastMessage && (
            <motion.div
              className="left-0 right-0 top-0 absolute z-10"
              initial={{ opacity: 0, translateY: -50 }}
              animate={{ opacity: 1, translateY: 0 }}
              exit={{ opacity: 0, translateY: -50 }}
            >
              <PlaygroundToast />
            </motion.div>
          )}
        </AnimatePresence>
        
        {showWelcome ? (
          <WelcomePage
            accentColor={config.settings.theme_color}
            onStartInterview={handleStartInterview}
          />
        ) : (
          <LiveKitRoom
            className="flex flex-col h-full w-full px-4"
            serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
            token={token}
            connect={shouldConnect}
            onError={(e) => {
              setToastMessage({ message: e.message, type: "error" });
              console.error(e);
            }}
          >
            <Playground
              themeColors={themeColors}
              onConnect={(c) => handleConnect(c, "env")}
              onEndCall={handleEndCall}
            />
            <RoomAudioRenderer />
            <StartAudio label="Click to enable audio playback" />
          </LiveKitRoom>
        )}
        
        {/* Analysis Loading Overlay */}
        {isAnalyzing && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-900 rounded-lg p-8 text-center max-w-md mx-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Analyzing Your Interview
              </h3>
              <p className="text-gray-600 dark:text-gray-300">
                Our AI is reviewing your responses and generating personalized feedback...
              </p>
            </div>
          </div>
        )}
      </main>
    </>
  );
}