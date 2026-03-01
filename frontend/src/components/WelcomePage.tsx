import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useConfig } from "@/hooks/useConfig";
import { Button } from "./button/Button";
import { InterviewForm } from "./InterviewForm";

type WelcomePageProps = {
  accentColor: string;
  onStartInterview: (formData?: any) => void;
};

export const WelcomePage = ({ accentColor, onStartInterview }: WelcomePageProps) => {
  const { config } = useConfig();
  const [showForm, setShowForm] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    try {
      const stored = typeof window !== "undefined" ? localStorage.getItem("theme") : null;
      const initial = stored === "dark" ? "dark" : "light";
      setTheme(initial);
    } catch (_) {
      // ignore
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    try {
      localStorage.setItem("theme", theme);
    } catch (_) {
      // ignore
    }
  }, [theme]);

  const handleStartClick = () => {
    setShowForm(true);
  };

  const handleFormSubmit = (formData: any) => {
    onStartInterview(formData);
  };

  const handleBackToWelcome = () => {
    setShowForm(false);
  };

  if (showForm) {
    return (
      <InterviewForm
        accentColor={accentColor}
        onSubmit={handleFormSubmit}
        onBack={handleBackToWelcome}
      />
    );
  }

  return (
    <div className="relative flex left-0 top-0 w-full h-full bg-white text-gray-900 dark:bg-black dark:text-white items-center justify-center text-center repeating-square-background" style={{ paddingTop: '112px' }}>
      {/* Theme Toggle - top right only on Welcome page */}
      <div className="absolute right-4 top-4">
        <button
          aria-label="Toggle theme"
          onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-gray-300 bg-white text-gray-800 shadow-sm hover:bg-gray-100 active:scale-95 transition dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {theme === "dark" ? (
            <>
              {/* Sun icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
              <span className="text-sm">Light</span>
            </>
          ) : (
            <>
              {/* Moon icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
              <span className="text-sm">Dark</span>
            </>
          )}
        </button>
      </div>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="flex flex-col items-center justify-center max-w-2xl mx-auto px-8"
      >
        {/* Logo/Title Section */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="mb-8"
        >
          {/* SkillCef AI Interviewer brand icon shown above the title */}
          <div className="flex items-center justify-center mb-4 gap-3">
            {/* Inline SkillCef icon — no dependency on external image files */}
            <svg width="48" height="48" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="#06B6D4"/>
              <circle cx="15" cy="11" r="4" fill="white"/>
              <path d="M7 27c0-4.418 3.582-8 8-8s8 3.582 8 8" stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
              <circle cx="23" cy="7" r="1.7" fill="white" opacity="0.9"/>
              <line x1="21.3" y1="8.2" x2="19.5" y2="9.8" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.85"/>
              <circle cx="25.5" cy="12" r="1.1" fill="white" opacity="0.65"/>
              <line x1="23.5" y1="8.6" x2="24.7" y2="11" stroke="white" strokeWidth="1.1" strokeLinecap="round" opacity="0.65"/>
            </svg>
          </div>
          <h1 className={`text-5xl md:text-6xl font-bold text-${accentColor}-500 dark:drop-shadow-${accentColor} mb-4`}>
            SkillCef AI
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-lg mx-auto leading-relaxed">
            AI-powered mock interview platform — practise, get feedback, and grow.
          </p>
        </motion.div>

        {/* Features Section */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="mb-12 grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-3xl"
        >
          <div className="flex flex-col items-center p-6 rounded-lg border backdrop-blur-sm bg-gray-100 border-gray-200 dark:bg-gray-950/50 dark:border-gray-800">
            <div className={`w-12 h-12 rounded-full bg-${accentColor}-500/20 flex items-center justify-center mb-4`}>
              <svg className={`w-6 h-6 text-${accentColor}-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">AI Interviewer</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
              Practice with an intelligent AI interviewer that adapts to your responses
            </p>
          </div>

          <div className="flex flex-col items-center p-6 rounded-lg border backdrop-blur-sm bg-gray-100 border-gray-200 dark:bg-gray-950/50 dark:border-gray-800">
            <div className={`w-12 h-12 rounded-full bg-${accentColor}-500/20 flex items-center justify-center mb-4`}>
              <svg className={`w-6 h-6 text-${accentColor}-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Real-time Feedback</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
              Get instant feedback on your responses and improve your interview skills
            </p>
          </div>

          <div className="flex flex-col items-center p-6 rounded-lg border backdrop-blur-sm bg-gray-100 border-gray-200 dark:bg-gray-950/50 dark:border-gray-800">
            <div className={`w-12 h-12 rounded-full bg-${accentColor}-500/20 flex items-center justify-center mb-4`}>
              <svg className={`w-6 h-6 text-${accentColor}-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Voice & Chat</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
              Interact through voice or chat - choose your preferred communication method
            </p>
          </div>
        </motion.div>

        {/* Start Button */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
        >
          <Button
            accentColor={accentColor}
            className={`px-12 py-4 text-lg font-semibold rounded-lg dark:shadow-lg-${accentColor} dark:hover:shadow-${accentColor} transition-all duration-300 transform hover:scale-105`}
            onClick={handleStartClick}
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Start Interview
          </Button>
        </motion.div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.6 }}
          className="mt-12 text-sm text-gray-500"
        >
          <p>Ready to practise? Click "Start Interview" to begin your SkillCef AI mock interview.</p>
        </motion.div>
      </motion.div>
    </div>
  );
};
