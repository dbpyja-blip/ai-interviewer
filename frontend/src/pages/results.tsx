import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Head from "next/head";
import { SegmentedVideoPlayer } from "@/components/recording/SegmentedVideoPlayer";
import { apiUrl, BACKEND_URL } from "@/config";

type AnalysisData = {
  markdown: string;
  summary: {
    overallScore: number;
    technicalScore: number;
    communicationScore: number;
    resumeScore: number;
    strengths: string[];
    areasToImprove: string[];
    recommendations: string[];
    keywords: string[];
    interviewDuration: string;
    responseQuality: string;
  };
  keywords: string[];
};

const ScoreCircle = ({ score, label, color }: { score: number; label: string; color: string }) => {
  const circumference = 2 * Math.PI * 45;
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-24">
        <svg className="w-24 h-24 transform -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="45"
            stroke="currentColor"
            strokeWidth="8"
            fill="transparent"
            className="text-gray-200 dark:text-gray-700"
          />
          <motion.circle
            cx="50"
            cy="50"
            r="45"
            stroke="currentColor"
            strokeWidth="8"
            fill="transparent"
            strokeDasharray={strokeDasharray}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className={color}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1.5, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.span
            className="text-xl font-bold text-gray-900 dark:text-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
          >
            {score}
          </motion.span>
        </div>
      </div>
      <p className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-300 text-center">{label}</p>
    </div>
  );
};

const MarkdownRenderer = ({ content }: { content: string }) => {
  // Simple markdown renderer for basic formatting
  const renderMarkdown = (text: string) => {
    return text
      .replace(/^# (.*$)/gm, '<h1 class="text-2xl font-bold mb-4 text-gray-900 dark:text-white">$1</h1>')
      .replace(/^## (.*$)/gm, '<h2 class="text-xl font-semibold mb-3 text-gray-800 dark:text-gray-100">$1</h2>')
      .replace(/^### (.*$)/gm, '<h3 class="text-lg font-medium mb-2 text-gray-700 dark:text-gray-200">$1</h3>')
      .replace(/^\* (.*$)/gm, '<li class="mb-1 text-gray-600 dark:text-gray-300">$1</li>')
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900 dark:text-white">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
      .replace(/\n\n/g, '</p><p class="mb-4 text-gray-600 dark:text-gray-300">')
      .replace(/\n/g, '<br>');
  };

  return (
    <div 
      className="prose prose-gray dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: `<p class="mb-4 text-gray-600 dark:text-gray-300">${renderMarkdown(content)}</p>` }}
    />
  );
};

export default function Results() {
  const router = useRouter();
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visionData, setVisionData] = useState<any>(null);
  const [proctorFaceUrl, setProctorFaceUrl] = useState<string | null>(null);
  const [tabSwitchCount, setTabSwitchCount] = useState<number>(0);
  const [proctorSignals, setProctorSignals] = useState<{
    gadgets_visible?: string[];
    other_persons_present?: boolean;
    other_persons_count?: number;
    unusual_items?: string[];
    red_flags?: string[];
    notes?: string;
  } | null>(null);
  const [proctorCodeUrl, setProctorCodeUrl] = useState<string | null>(null);
  const [annotatedImages, setAnnotatedImages] = useState<string[]>([]);
  const [allDetections, setAllDetections] = useState<any[]>([]);
  const [detectionStats, setDetectionStats] = useState<{
    totalDetections: number;
    personsDetected: number;
    gadgetsDetected: number;
    totalFramesAnalyzed: number;
  }>({
    totalDetections: 0,
    personsDetected: 0,
    gadgetsDetected: 0,
    totalFramesAnalyzed: 0
  });
  
  // Recording data
  const [recordingMetadata, setRecordingMetadata] = useState<any>(null);
  const [recordingLoading, setRecordingLoading] = useState(false);
  
  // Conversation tracking data
  const [conversationTranscripts, setConversationTranscripts] = useState<Array<{
    name: string;
    message: string;
    timestamp: number;
    isSelf: boolean;
  }>>([]);
  const [candidateName, setCandidateName] = useState<string>("Candidate");
  const [lastSessionId, setLastSessionId] = useState<string>("");

  // Helper function to load cached proctoring data from localStorage
  const loadCachedProctoringData = (sessionId: string) => {
    console.log('📦 Loading cached proctoring data from localStorage...');
    let loadedCount = 0;
    
    // Load annotated images
    const cachedAnnotatedImages = localStorage.getItem(`annotated_images_${sessionId}`);
    if (cachedAnnotatedImages) {
      try {
        const parsedImages = JSON.parse(cachedAnnotatedImages);
        setAnnotatedImages(parsedImages);
        console.log(`✅ Restored ${parsedImages.length} annotated images`);
        loadedCount++;
      } catch (e) {
        console.error('Failed to parse cached annotated images:', e);
      }
    }
    
    // Load all detections
    const cachedDetections = localStorage.getItem(`all_detections_${sessionId}`);
    if (cachedDetections) {
      try {
        const parsedDetections = JSON.parse(cachedDetections);
        setAllDetections(parsedDetections);
        console.log(`✅ Restored ${parsedDetections.length} detections`);
        loadedCount++;
      } catch (e) {
        console.error('Failed to parse cached detections:', e);
      }
    }
    
    // Load detection stats
    const cachedStats = localStorage.getItem(`detection_stats_${sessionId}`);
    if (cachedStats) {
      try {
        const parsedStats = JSON.parse(cachedStats);
        setDetectionStats(parsedStats);
        console.log(`✅ Restored detection stats`);
        loadedCount++;
      } catch (e) {
        console.error('Failed to parse cached detection stats:', e);
      }
    }
    
    // Load proctoring signals
    const cachedSignals = localStorage.getItem(`proctor_signals_${sessionId}`);
    if (cachedSignals) {
      try {
        const parsedSignals = JSON.parse(cachedSignals);
        setProctorSignals(parsedSignals);
        console.log(`✅ Restored proctoring signals`);
        loadedCount++;
      } catch (e) {
        console.error('Failed to parse cached proctoring signals:', e);
      }
    }
    
    // Load proctoring snapshots URLs
    const faceUrl = localStorage.getItem(`proctor_face_url_${sessionId}`);
    if (faceUrl) {
      setProctorFaceUrl(faceUrl);
      console.log(`✅ Restored face snapshot URL`);
      loadedCount++;
    }
    
    const codeUrl = localStorage.getItem(`proctor_code_url_${sessionId}`);
    if (codeUrl) {
      setProctorCodeUrl(codeUrl);
      console.log(`✅ Restored code snapshot URL`);
      loadedCount++;
    }
    
    const tabCount = parseInt(localStorage.getItem(`proctor_tab_switch_count_${sessionId}`) || '0', 10) || 0;
    if (tabCount > 0) {
      setTabSwitchCount(tabCount);
      console.log(`✅ Restored tab switch count: ${tabCount}`);
      loadedCount++;
    }
    
    if (loadedCount > 0) {
      console.log(`🎉 Successfully restored ${loadedCount} cached datasets from localStorage`);
    } else {
      console.log(`⚠️ No cached proctoring data found in localStorage`);
    }
  };

  useEffect(() => {
    const loadAnalysisData = async () => {
      // Analysis data is always read from localStorage — never from the URL.
      // Putting large JSON in URL query params is bad because:
      //   1. It makes the address bar look horrible (hundreds of chars).
      //   2. It leaks the full analysis report to anyone who sees the screen / copies the link.
      // index.tsx saves the result to localStorage before navigating here,
      // so the data is always available on the first render.
      let parsed: AnalysisData | null = null;

      const stored = localStorage.getItem("interviewAnalysis");
      if (stored) {
        try {
          parsed = JSON.parse(stored);
          console.log("📊 Analysis data loaded from localStorage:", parsed);
        } catch (e) {
          console.error("❌ Failed to parse analysis data from localStorage:", e);
          setError("Failed to load analysis data");
          setLoading(false);
          return;
        }
      } else {
        console.error("❌ No analysis data found in localStorage");
        setError("No analysis data found");
        setLoading(false);
        return;
      }

      // Validate and normalize the data structure
      if (parsed) {
        // Ensure all required fields exist
        if (!parsed.summary) {
          console.warn("⚠️ Missing summary, creating default");
          parsed.summary = {
            overallScore: 0,
            technicalScore: 0,
            communicationScore: 0,
            resumeScore: 0,
            strengths: [],
            areasToImprove: [],
            recommendations: [],
            keywords: [],
            interviewDuration: "Unknown",
            responseQuality: "Unknown"
          };
        } else {
          // Normalize summary fields
          parsed.summary = {
            overallScore: parsed.summary.overallScore ?? 0,
            technicalScore: parsed.summary.technicalScore ?? 0,
            communicationScore: parsed.summary.communicationScore ?? 0,
            resumeScore: parsed.summary.resumeScore ?? 0,
            strengths: Array.isArray(parsed.summary.strengths) ? parsed.summary.strengths : [],
            areasToImprove: Array.isArray(parsed.summary.areasToImprove) ? parsed.summary.areasToImprove : [],
            recommendations: Array.isArray(parsed.summary.recommendations) ? parsed.summary.recommendations : [],
            keywords: Array.isArray(parsed.summary.keywords) ? parsed.summary.keywords : [],
            interviewDuration: parsed.summary.interviewDuration ?? "Unknown",
            responseQuality: parsed.summary.responseQuality ?? "Unknown"
          };
        }

        // Ensure markdown exists
        if (!parsed.markdown) {
          parsed.markdown = "# Interview Analysis\n\nAnalysis data is being processed...";
        }

        // Ensure keywords array exists (use summary.keywords if top-level is missing)
        if (!parsed.keywords || parsed.keywords.length === 0) {
          parsed.keywords = parsed.summary.keywords || [];
        }

        console.log("✅ Normalized analysis data:", {
          markdownLength: parsed.markdown?.length,
          overallScore: parsed.summary.overallScore,
          strengthsCount: parsed.summary.strengths.length,
          keywordsCount: parsed.keywords.length
        });

        setAnalysisData(parsed);
      }

      // Load candidate name from localStorage
      try {
        const candidateDataStr = localStorage.getItem("currentCandidateData");
        if (candidateDataStr) {
          const candidateData = JSON.parse(candidateDataStr);
          if (candidateData.fullName) {
            setCandidateName(candidateData.fullName);
            console.log(`✅ Loaded candidate name: ${candidateData.fullName}`);
          }
        }
      } catch (e) {
        console.warn("Failed to load candidate name:", e);
      }
      
      // Fetch vision analysis data
      const sessionId = localStorage.getItem("lastInterviewSessionId");
      if (sessionId) {
        setLastSessionId(sessionId);
        // Load conversation transcripts
        try {
          const transcriptsStr = localStorage.getItem(`interview_transcripts_${sessionId}`);
          if (transcriptsStr) {
            const transcripts = JSON.parse(transcriptsStr);
            if (Array.isArray(transcripts) && transcripts.length > 0) {
              setConversationTranscripts(transcripts);
              console.log(`✅ Loaded ${transcripts.length} conversation transcripts`);
            }
          }
        } catch (e) {
          console.warn("Failed to load conversation transcripts:", e);
        }
        
        console.log("=".repeat(80));
        console.log("📊 FETCHING PROCTORING DATA FROM BACKEND");
        console.log("=".repeat(80));
        console.log(`Session ID: ${sessionId}`);
        
        try {
          const response = await fetch(apiUrl(`/api/vision-analysis/${sessionId}`));
          if (response.ok) {
            const visionResult = await response.json();
            console.log("✅ Received vision analysis response:", visionResult);
            
            if (visionResult.success) {
              setVisionData(visionResult.data);
              
              console.log("📸 Vision Data Summary:");
              console.log(`   Face analyses: ${visionResult.data?.face_analyses?.length || 0}`);
              console.log(`   Screen analyses: ${visionResult.data?.screen_analyses?.length || 0}`);
              console.log(`   Code submissions: ${visionResult.data?.code_submissions?.length || 0}`);
              
              // Extract latest face proctoring signals if available
              try {
                const faces = visionResult.data?.face_analyses || [];
                console.log(`\n🔍 Processing ${faces.length} face analyses...`);
                
                if (faces.length > 0) {
                  const latest = faces[faces.length - 1]?.analysis;
                  let parsed = latest;
                  if (typeof latest === 'string') {
                    try { parsed = JSON.parse(latest); } catch {}
                  }
                  
                  console.log("Latest face analysis:", parsed);
                  
                  if (parsed && parsed.proctoring) {
                    console.log("\n🚨 PROCTORING SIGNALS DETECTED:");
                    console.log("=".repeat(80));
                    console.log(JSON.stringify(parsed.proctoring, null, 2));
                    console.log("=".repeat(80));
                    
                    setProctorSignals(parsed.proctoring);
                    
                    // CACHE proctoring signals for page reload persistence
                    localStorage.setItem(`proctor_signals_${sessionId}`, JSON.stringify(parsed.proctoring));
                    console.log(`💾 Cached proctoring signals to localStorage`);
                    
                    // Log what will be displayed
                    console.log("\n📊 Data being displayed in UI:");
                    console.log(`   Gadgets: ${parsed.proctoring.gadgets_visible?.join(', ') || 'None'}`);
                    console.log(`   Other persons: ${parsed.proctoring.other_persons_count || 0}`);
                    console.log(`   Unusual items: ${parsed.proctoring.unusual_items?.join(', ') || 'None'}`);
                    console.log(`   Red flags: ${parsed.proctoring.red_flags?.length || 0}`);
                    if (parsed.proctoring.red_flags && parsed.proctoring.red_flags.length > 0) {
                      parsed.proctoring.red_flags.forEach((flag: string, i: number) => {
                        console.log(`      ${i + 1}. ${flag}`);
                      });
                    }
                  } else {
                    console.log("⚠️ No proctoring data in latest face analysis");
                  }
                }
                
                // Extract annotated images with bounding boxes
                const annotatedUrls: string[] = [];
                faces.forEach((faceAnalysis: any) => {
                  if (faceAnalysis.analysis && faceAnalysis.analysis.annotated_image_url) {
                    annotatedUrls.push(faceAnalysis.analysis.annotated_image_url);
                  }
                });
                
                // Also check screen analyses
                const screens = visionResult.data?.screen_analyses || [];
                screens.forEach((screenAnalysis: any) => {
                  if (screenAnalysis.analysis && screenAnalysis.analysis.annotated_image_url) {
                    annotatedUrls.push(screenAnalysis.analysis.annotated_image_url);
                  }
                });
                
                if (annotatedUrls.length > 0) {
                  console.log(`\n🖼️  Found ${annotatedUrls.length} annotated images with bounding boxes`);
                  setAnnotatedImages(annotatedUrls);
                  // CACHE annotated images in localStorage for page reload persistence
                  localStorage.setItem(`annotated_images_${sessionId}`, JSON.stringify(annotatedUrls));
                  console.log(`💾 Cached ${annotatedUrls.length} annotated image URLs to localStorage`);
                }
                
                // Extract ALL detections for display
                const allDetectionsList: any[] = [];
                let totalPersons = 0;
                let totalGadgets = 0;
                
                faces.forEach((faceAnalysis: any) => {
                  if (faceAnalysis.analysis && faceAnalysis.analysis.detections) {
                    faceAnalysis.analysis.detections.forEach((detection: any) => {
                      allDetectionsList.push({
                        ...detection,
                        frameType: 'face',
                        timestamp: faceAnalysis.timestamp
                      });
                      
                      if (detection.label === 'person') totalPersons++;
                      if (['cell phone', 'laptop', 'keyboard', 'mouse'].includes(detection.label)) {
                        totalGadgets++;
                      }
                    });
                  }
                });
                
                screens.forEach((screenAnalysis: any) => {
                  if (screenAnalysis.analysis && screenAnalysis.analysis.detections) {
                    screenAnalysis.analysis.detections.forEach((detection: any) => {
                      allDetectionsList.push({
                        ...detection,
                        frameType: 'screen',
                        timestamp: screenAnalysis.timestamp
                      });
                      
                      if (detection.label === 'person') totalPersons++;
                      if (['cell phone', 'laptop', 'keyboard', 'mouse'].includes(detection.label)) {
                        totalGadgets++;
                      }
                    });
                  }
                });
                
                console.log(`\n📊 TOTAL DETECTIONS ACROSS ALL FRAMES: ${allDetectionsList.length}`);
                console.log(`   Persons: ${totalPersons}`);
                console.log(`   Gadgets: ${totalGadgets}`);
                
                setAllDetections(allDetectionsList);
                const stats = {
                  totalDetections: allDetectionsList.length,
                  personsDetected: totalPersons,
                  gadgetsDetected: totalGadgets,
                  totalFramesAnalyzed: faces.length + screens.length
                };
                setDetectionStats(stats);
                
                // CACHE detections and stats in localStorage for page reload persistence
                localStorage.setItem(`all_detections_${sessionId}`, JSON.stringify(allDetectionsList));
                localStorage.setItem(`detection_stats_${sessionId}`, JSON.stringify(stats));
                console.log(`💾 Cached ${allDetectionsList.length} detections and stats to localStorage`);
              } catch (err) {
                console.error("❌ Error processing proctoring signals:", err);
              }
            }
          } else {
            console.error(`❌ Failed to fetch vision analysis: ${response.status} ${response.statusText}`);
            console.log('🔄 Attempting to load cached data from localStorage...');
            // Try to load from localStorage cache if backend fetch fails
            loadCachedProctoringData(sessionId);
          }
        } catch (err) {
          console.error("❌ Failed to fetch vision analysis:", err);
          console.log('🔄 Attempting to load cached data from localStorage...');
          // Try to load from localStorage cache if backend fetch fails
          loadCachedProctoringData(sessionId);
        }
        
        console.log("=".repeat(80));
        console.log("");
        
        // Load proctoring items from localStorage (if not already loaded from backend)
        if (!proctorFaceUrl) {
          const faceUrl = localStorage.getItem(`proctor_face_url_${sessionId}`);
          if (faceUrl) setProctorFaceUrl(faceUrl);
        }
        if (!proctorCodeUrl) {
          const codeUrl = localStorage.getItem(`proctor_code_url_${sessionId}`);
          if (codeUrl) setProctorCodeUrl(codeUrl);
        }
        if (tabSwitchCount === 0) {
          const tabCount = parseInt(localStorage.getItem(`proctor_tab_switch_count_${sessionId}`) || '0', 10) || 0;
          setTabSwitchCount(tabCount);
        }
        
        // Fetch recording metadata
        setRecordingLoading(true);
        try {
          const recordingResponse = await fetch(apiUrl(`/api/recording/metadata/${sessionId}`));
          if (recordingResponse.ok) {
            const recordingResult = await recordingResponse.json();
            if (recordingResult.success && recordingResult.metadata) {
              setRecordingMetadata(recordingResult.metadata);
              console.log("✅ Recording metadata loaded:", recordingResult.metadata);
            }
          } else {
            console.log("⚠️ No recording metadata available for this session");
          }
        } catch (err) {
          console.error("❌ Failed to fetch recording metadata:", err);
        } finally {
          setRecordingLoading(false);
        }
      }

      setLoading(false);
    };

    loadAnalysisData();
  // Empty dependency array: we read from localStorage once on mount.
  // Previously this was [router.query] which would re-run whenever the URL changed —
  // that is no longer needed because we never put data in the URL.
  }, []);

  const handleViewSegmentsPage = () => {
    const sessionId = lastSessionId || (typeof window !== "undefined" ? localStorage.getItem("lastInterviewSessionId") || "" : "");
    if (!sessionId) {
      alert("Session information is not available yet. Please complete an interview first.");
      return;
    }
    router.push(`/analysis?sessionId=${encodeURIComponent(sessionId)}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-300">Analyzing your interview...</p>
        </div>
      </div>
    );
  }

  if (error || !analysisData) {
    return (
      <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Analysis Not Available</h1>
          <p className="text-gray-600 dark:text-gray-300 mb-6">{error || "No analysis data found"}</p>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-3 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors"
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  const { summary } = analysisData;

  return (
    <>
      <Head>
        <title>Interview Results — SkillCef AI Interviewer</title>
        <meta name="description" content="Your personalised interview analysis and feedback from SkillCef AI Interviewer" />
        <link rel="icon" type="image/svg+xml" href="/skillcef-icon.svg" />
      </Head>
      
      <div className="min-h-screen bg-white dark:bg-black text-gray-900 dark:text-white">
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-8"
          >
            <h1 className="text-4xl font-bold text-cyan-500 mb-2">Interview Analysis</h1>
            <p className="text-gray-600 dark:text-gray-300">Your personalized feedback and recommendations</p>
          </motion.div>

          {/* Score Dashboard */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 mb-8"
          >
            <h2 className="text-2xl font-semibold mb-6 text-center">Performance Scores</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <ScoreCircle 
                score={summary.overallScore} 
                label="Overall Score" 
                color="text-cyan-500" 
              />
              <ScoreCircle 
                score={summary.technicalScore} 
                label="Technical Skills" 
                color="text-green-500" 
              />
              <ScoreCircle 
                score={summary.communicationScore} 
                label="Communication" 
                color="text-blue-500" 
              />
              <ScoreCircle 
                score={summary.resumeScore} 
                label="Resume Match" 
                color="text-purple-500" 
              />
            </div>
          </motion.div>

          {/* Quick Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8"
          >
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-center">
              <h3 className="font-semibold text-gray-700 dark:text-gray-300">Interview Duration</h3>
              <p className="text-2xl font-bold text-cyan-500">{summary.interviewDuration}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-center">
              <h3 className="font-semibold text-gray-700 dark:text-gray-300">Response Quality</h3>
              <p className="text-lg font-medium text-gray-900 dark:text-white">{summary.responseQuality}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-center">
              <h3 className="font-semibold text-gray-700 dark:text-gray-300">Keywords Covered</h3>
              <p className="text-2xl font-bold text-green-500">{summary.keywords.length}</p>
            </div>
          </motion.div>

          {/* Conversation Tracking Section */}
          {conversationTranscripts.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="mb-8"
            >
              <div className="bg-gradient-to-br from-cyan-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 rounded-xl p-6 border-2 border-cyan-200 dark:border-cyan-800 shadow-lg">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-2">
                  <h2 className="text-3xl font-bold text-cyan-600 dark:text-cyan-400 flex items-center gap-2">
                    💬 Complete Interview Conversation
                  </h2>
                  {recordingMetadata && recordingMetadata.segments && recordingMetadata.segments.length > 0 && (
                    <button
                      onClick={handleViewSegmentsPage}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-cyan-500 text-white text-sm font-medium shadow-sm hover:bg-cyan-600 transition-colors"
                    >
                      View Segment-wise Replay
                    </button>
                  )}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                  Full transcript of the conversation between <span className="font-semibold text-cyan-600 dark:text-cyan-400">{candidateName}</span> and the Interview Agent
                </p>
                
                {/* Conversation Messages Container */}
                <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-h-[600px] overflow-y-auto border border-gray-200 dark:border-gray-700">
                  <div className="space-y-4">
                    {conversationTranscripts.map((msg, index) => {
                      // Determine if message is from agent or candidate
                      // isSelf = true means candidate, false means agent
                      const isAgent = !msg.isSelf;
                      // Check if previous message was from same speaker to hide duplicate name
                      const prevMsg = index > 0 ? conversationTranscripts[index - 1] : null;
                      const hideName = prevMsg && ((isAgent && !prevMsg.isSelf) || (!isAgent && prevMsg.isSelf));
                      const timestamp = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      
                      // Use candidate name for candidate messages, or keep original name if it's not "You"
                      const displayName = isAgent ? 'Interview Agent' : candidateName;
                      
                      return (
                        <div
                          key={index}
                          className={`flex flex-col ${isAgent ? 'items-start' : 'items-end'} ${hideName ? 'pt-2' : 'pt-4'}`}
                        >
                          {!hideName && (
                            <div className={`flex items-center gap-2 mb-1 ${isAgent ? 'flex-row' : 'flex-row-reverse'}`}>
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm ${
                                isAgent 
                                  ? 'bg-cyan-500 text-white' 
                                  : 'bg-blue-500 text-white'
                              }`}>
                                {isAgent ? 'AI' : candidateName.charAt(0).toUpperCase()}
                              </div>
                              <span className={`text-xs font-semibold ${
                                isAgent 
                                  ? 'text-cyan-600 dark:text-cyan-400' 
                                  : 'text-blue-600 dark:text-blue-400'
                              }`}>
                                {displayName}
                              </span>
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {timestamp}
                              </span>
                            </div>
                          )}
                          <div
                            className={`max-w-[80%] rounded-lg px-4 py-3 shadow-sm ${
                              isAgent
                                ? 'bg-cyan-100 dark:bg-cyan-900/30 text-gray-900 dark:text-gray-100 border-l-4 border-cyan-500'
                                : 'bg-blue-100 dark:bg-blue-900/30 text-gray-900 dark:text-gray-100 border-l-4 border-blue-500'
                            }`}
                          >
                            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                              {msg.message}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                {/* Conversation Stats */}
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center border border-gray-200 dark:border-gray-700">
                    <div className="text-2xl font-bold text-cyan-600">{conversationTranscripts.length}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Total Messages</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center border border-gray-200 dark:border-gray-700">
                    <div className="text-2xl font-bold text-blue-600">
                      {conversationTranscripts.filter(m => !m.isSelf).length}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">{candidateName}'s Messages</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center border border-gray-200 dark:border-gray-700">
                    <div className="text-2xl font-bold text-cyan-600">
                      {conversationTranscripts.filter(m => m.isSelf).length}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Agent Messages</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center border border-gray-200 dark:border-gray-700">
                    <div className="text-2xl font-bold text-green-600">
                      {conversationTranscripts.reduce((acc, m) => acc + m.message.length, 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Total Characters</div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}



          {/* Proctoring Section - COMPREHENSIVE DISPLAY */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mb-8"
          >
            <h2 className="text-3xl font-bold mb-6 text-cyan-500">🔒 Proctoring Report</h2>
            
            {/* Detection Statistics Summary */}
            <div className="bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 rounded-xl p-6 mb-6 border-2 border-cyan-200 dark:border-cyan-800">
              <h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">📊 Detection Statistics</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-cyan-600">{detectionStats.totalDetections}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Total Detections</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-600">{detectionStats.personsDetected}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Person Detections</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-orange-600">{detectionStats.gadgetsDetected}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Gadgets Detected</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-purple-600">{detectionStats.totalFramesAnalyzed}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Frames Analyzed</div>
                </div>
              </div>
            </div>

            {/* Red Flags Alert */}
            {proctorSignals?.red_flags && proctorSignals.red_flags.length > 0 && (
              <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-500 rounded-xl p-6 mb-6">
                <h3 className="text-xl font-semibold mb-3 text-red-600 dark:text-red-400 flex items-center gap-2">
                  🚨 Red Flags Detected ({proctorSignals.red_flags.length})
                </h3>
                <ul className="space-y-2">
                  {proctorSignals.red_flags.map((flag: string, index: number) => (
                    <li key={index} className="flex items-start gap-2 text-sm">
                      <span className="text-red-500 font-bold">{index + 1}.</span>
                      <span className="text-gray-900 dark:text-gray-100">{flag}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Proctoring Details Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              {/* Gadgets Visible */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border-2 border-gray-200 dark:border-gray-700 shadow-lg">
                <h4 className="font-semibold mb-3 text-lg flex items-center gap-2">
                  📱 Gadgets Detected
                </h4>
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  {(proctorSignals?.gadgets_visible && proctorSignals.gadgets_visible.length > 0) ? (
                    <ul className="space-y-1">
                      {proctorSignals.gadgets_visible.map((gadget: string, idx: number) => (
                        <li key={idx} className="flex items-center gap-2">
                          <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                          <span className="capitalize font-medium">{gadget}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-green-600 dark:text-green-400 font-medium">✓ No gadgets detected</div>
                  )}
                </div>
              </div>

              {/* Persons Detected */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border-2 border-gray-200 dark:border-gray-700 shadow-lg">
                <h4 className="font-semibold mb-3 text-lg flex items-center gap-2">
                  👥 Persons in Frame
                </h4>
                <div className="text-4xl font-bold text-center my-2">
                  {proctorSignals?.other_persons_present ? (
                    <span className="text-red-500">{(proctorSignals?.other_persons_count ?? 0) + 1}</span>
                  ) : (
                    <span className="text-green-500">1</span>
                  )}
                </div>
                <div className="text-center text-sm">
                  {proctorSignals?.other_persons_present ? (
                    <span className="text-red-600 dark:text-red-400 font-medium">
                      ⚠️ Multiple persons detected
                    </span>
                  ) : (
                    <span className="text-green-600 dark:text-green-400 font-medium">
                      ✓ Only candidate visible
                    </span>
                  )}
                </div>
              </div>

              {/* Unusual Items */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border-2 border-gray-200 dark:border-gray-700 shadow-lg">
                <h4 className="font-semibold mb-3 text-lg flex items-center gap-2">
                  📚 Unusual Items
                </h4>
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  {(proctorSignals?.unusual_items && proctorSignals.unusual_items.length > 0) ? (
                    <ul className="space-y-1">
                      {proctorSignals.unusual_items.map((item: string, idx: number) => (
                        <li key={idx} className="flex items-center gap-2">
                          <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                          <span className="capitalize font-medium">{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-green-600 dark:text-green-400 font-medium">✓ No unusual items</div>
                  )}
                </div>
              </div>
            </div>

            {/* All Detections Table */}
            {allDetections.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border-2 border-gray-200 dark:border-gray-700 shadow-lg mb-6">
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  🔍 All Detections ({allDetections.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100 dark:bg-gray-900">
                      <tr>
                        <th className="px-4 py-2 text-left">#</th>
                        <th className="px-4 py-2 text-left">Object</th>
                        <th className="px-4 py-2 text-left">Confidence</th>
                        <th className="px-4 py-2 text-left">Frame Type</th>
                        <th className="px-4 py-2 text-left">Bounding Box</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {allDetections.map((detection, index) => (
                        <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-900">
                          <td className="px-4 py-2 font-medium">{index + 1}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold
                              ${detection.label === 'person' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : ''}
                              ${detection.label === 'cell phone' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : ''}
                              ${detection.label === 'laptop' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' : ''}
                              ${!['person', 'cell phone', 'laptop'].includes(detection.label) ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' : ''}
                            `}>
                              {detection.label}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <span className="font-semibold text-cyan-600">{(detection.confidence * 100).toFixed(1)}%</span>
                          </td>
                          <td className="px-4 py-2 capitalize">{detection.frameType}</td>
                          <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400">
                            [{detection.bounding_box.x_min.toFixed(0)}, {detection.bounding_box.y_min.toFixed(0)}] 
                            → [{detection.bounding_box.x_max.toFixed(0)}, {detection.bounding_box.y_max.toFixed(0)}]
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Snapshots */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              {/* Candidate Image */}
              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 border-2 border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold mb-3 text-center">Candidate Snapshot</h3>
                {proctorFaceUrl ? (
                  <img src={`${BACKEND_URL}${proctorFaceUrl}`} alt="Candidate" className="w-full rounded-lg border border-gray-300 dark:border-gray-600" />
                ) : (
                  <div className="text-sm text-gray-500 text-center p-8">No snapshot captured</div>
                )}
              </div>

              {/* Code Snapshot */}
              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 border-2 border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold mb-3 text-center">Code Snapshot</h3>
                {proctorCodeUrl ? (
                  <img src={`${BACKEND_URL}${proctorCodeUrl}`} alt="Code Snapshot" className="w-full rounded-lg border border-gray-300 dark:border-gray-600" />
                ) : (
                  <div className="text-sm text-gray-500 text-center p-8">Not captured</div>
                )}
              </div>

              {/* Tab Switches */}
              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 border-2 border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center">
                <h3 className="font-semibold mb-3">Tab Switches</h3>
                <div className="text-5xl font-bold text-orange-500">{tabSwitchCount}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mt-2">times during interview</div>
              </div>
            </div>

            {/* Notes */}
            {proctorSignals?.notes && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-300 dark:border-blue-700 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400 font-semibold">📝 Notes:</span>
                  <span className="text-gray-900 dark:text-gray-100">{proctorSignals.notes}</span>
                </div>
              </div>
            )}
          </motion.div>

          {/* Annotated Images with Bounding Boxes */}
          {annotatedImages.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="mb-8"
            >
              <h2 className="text-3xl font-bold mb-6 text-cyan-500">🎯 Detection Images with Bounding Boxes</h2>
              <div className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 rounded-xl p-6 border-2 border-gray-200 dark:border-gray-700">
                {/* Color Legend */}
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 mb-6 border border-gray-300 dark:border-gray-600">
                  <h3 className="font-semibold mb-3 text-center">📌 Bounding Box Color Legend</h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-green-500 border-2 border-green-700"></div>
                      <span>Person</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-red-500 border-2 border-red-700"></div>
                      <span>Cell Phone</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-orange-500 border-2 border-orange-700"></div>
                      <span>Laptop</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-yellow-500 border-2 border-yellow-700"></div>
                      <span>Book</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-cyan-500 border-2 border-cyan-700"></div>
                      <span>Other</span>
                    </div>
                  </div>
                </div>
                
                {/* Images Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {annotatedImages.map((imageUrl, index) => (
                    <div key={index} className="bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 rounded-xl overflow-hidden shadow-lg hover:shadow-2xl transition-shadow">
                      <img 
                        src={`${BACKEND_URL}${imageUrl}`} 
                        alt={`Detection ${index + 1}`}
                        className="w-full h-auto"
                        onError={(e) => {
                          console.error(`Failed to load image: ${imageUrl}`);
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      <div className="p-3 bg-gradient-to-r from-cyan-100 to-blue-100 dark:from-cyan-900 dark:to-blue-900">
                        <div className="text-sm font-semibold text-center text-gray-900 dark:text-white">
                          🔍 Detection Frame #{index + 1}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="mt-6 bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 rounded-lg p-4">
                  <p className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2">
                    <span className="text-blue-600 dark:text-blue-400 text-lg">💡</span>
                    <span>
                      <strong>What you're seeing:</strong> These images show exactly what the AI detected during your interview. 
                      Colored bounding boxes mark each detected object with its label and confidence score. 
                      This provides transparent proof of all proctoring detections.
                    </span>
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Detailed Analysis */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.6 }}
              className="lg:col-span-2"
            >
              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6">
                <h2 className="text-2xl font-semibold mb-4">Detailed Analysis</h2>
                <MarkdownRenderer content={analysisData.markdown} />
              </div>
            </motion.div>

            {/* Sidebar */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.8 }}
              className="space-y-6"
            >
              {/* Strengths */}
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                <h3 className="font-semibold text-green-800 dark:text-green-300 mb-3">Key Strengths</h3>
                {summary.strengths && summary.strengths.length > 0 ? (
                  <ul className="space-y-2">
                    {summary.strengths.map((strength, index) => (
                      <li key={index} className="text-sm text-green-700 dark:text-green-400 flex items-start">
                        <span className="text-green-500 mr-2">✓</span>
                        {strength}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">No strengths identified yet</p>
                )}
              </div>

              {/* Areas to Improve */}
              <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4">
                <h3 className="font-semibold text-orange-800 dark:text-orange-300 mb-3">Areas to Improve</h3>
                {summary.areasToImprove && summary.areasToImprove.length > 0 ? (
                  <ul className="space-y-2">
                    {summary.areasToImprove.map((area, index) => (
                      <li key={index} className="text-sm text-orange-700 dark:text-orange-400 flex items-start">
                        <span className="text-orange-500 mr-2">→</span>
                        {area}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">No improvement areas identified yet</p>
                )}
              </div>

              {/* Recommendations */}
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                <h3 className="font-semibold text-blue-800 dark:text-blue-300 mb-3">Recommendations</h3>
                {summary.recommendations && summary.recommendations.length > 0 ? (
                  <ul className="space-y-2">
                    {summary.recommendations.map((rec, index) => (
                      <li key={index} className="text-sm text-blue-700 dark:text-blue-400 flex items-start">
                        <span className="text-blue-500 mr-2">•</span>
                        {rec}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">No recommendations available yet</p>
                )}
              </div>

              {/* Keywords */}
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
                <h3 className="font-semibold text-purple-800 dark:text-purple-300 mb-3">Technical Keywords</h3>
                {summary.keywords && summary.keywords.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {summary.keywords.map((keyword, index) => (
                      <span
                        key={index}
                        className="px-2 py-1 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 text-xs rounded-full"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">No keywords identified yet</p>
                )}
              </div>
            </motion.div>
          </div>

          {/* Recording Video Player */}
          {recordingMetadata && recordingMetadata.segments && recordingMetadata.segments.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9 }}
              className="mt-8 mb-8"
            >
              <SegmentedVideoPlayer
                sessionId={localStorage.getItem("lastInterviewSessionId") || ""}
                segments={recordingMetadata.segments}
                transcripts={recordingMetadata.transcripts || []}
                metadata={recordingMetadata}
              />
            </motion.div>
          )}

          {/* Actions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.0 }}
            className="mt-8 text-center space-x-4"
          >
            <button
              onClick={() => window.print()}
              className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Print Report
            </button>
            <button
              onClick={() => router.push("/")}
              className="px-6 py-3 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors"
            >
              Take Another Interview
            </button>
          </motion.div>
        </div>
      </div>
    </>
  );
}
