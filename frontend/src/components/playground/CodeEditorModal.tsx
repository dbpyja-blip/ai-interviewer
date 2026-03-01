import React, { useState, useEffect, useRef } from "react";
import { apiUrl } from "@/config";

interface CodeEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (code: string, language: string) => void;
  sessionId: string;
  accentColor: string;
}

const LANGUAGES = [
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
  { value: "c", label: "C" },
  { value: "csharp", label: "C#" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" },
];

export const CodeEditorModal = ({
  isOpen,
  onClose,
  onSubmit,
  sessionId,
  accentColor,
}: CodeEditorModalProps) => {
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("python");
  const [isDark, setIsDark] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Load saved code from session storage
  useEffect(() => {
    if (isOpen && sessionId) {
      const savedCode = localStorage.getItem(`code_editor_${sessionId}`);
      const savedLanguage = localStorage.getItem(`code_editor_lang_${sessionId}`);
      
      if (savedCode) {
        setCode(savedCode);
      }
      if (savedLanguage) {
        setLanguage(savedLanguage);
      }

      // Detect system theme
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setIsDark(prefersDark);
    }
  }, [isOpen, sessionId]);

  // Auto-save code to session storage
  useEffect(() => {
    if (sessionId && code) {
      localStorage.setItem(`code_editor_${sessionId}`, code);
    }
  }, [code, sessionId]);

  // Save language preference
  useEffect(() => {
    if (sessionId && language) {
      localStorage.setItem(`code_editor_lang_${sessionId}`, language);
    }
  }, [language, sessionId]);

  // Capture code editor as image
  const captureCodeEditorScreenshot = async (): Promise<string | null> => {
    if (!code.trim() || !editorContainerRef.current) return null;
    
    try {
      console.log('📸 Capturing code editor screenshot...');
      
      // Create a canvas to render the code
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      
      // Set canvas size (large enough for code display)
      canvas.width = 1200;
      const lines = code.split('\n');
      const lineHeight = 24;
      const padding = 40;
      canvas.height = Math.max(600, (lines.length * lineHeight) + (padding * 2));
      
      // Background
      ctx.fillStyle = isDark ? '#1f2937' : '#f9fafb';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Header with language info
      ctx.fillStyle = isDark ? '#374151' : '#e5e7eb';
      ctx.fillRect(0, 0, canvas.width, 50);
      
      ctx.fillStyle = isDark ? '#f3f4f6' : '#1f2937';
      ctx.font = 'bold 16px monospace';
      ctx.fillText(`${language.toUpperCase()} CODE`, padding, 32);
      
      // Separator line
      ctx.strokeStyle = isDark ? '#4b5563' : '#d1d5db';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 50);
      ctx.lineTo(canvas.width, 50);
      ctx.stroke();
      
      // Code content
      ctx.fillStyle = isDark ? '#f3f4f6' : '#1f2937';
      ctx.font = '14px "Courier New", monospace';
      
      lines.forEach((line, index) => {
        const y = 50 + padding + (index * lineHeight);
        // Line number
        ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280';
        ctx.fillText(`${(index + 1).toString().padStart(3, ' ')}`, 20, y);
        
        // Code line
        ctx.fillStyle = isDark ? '#f3f4f6' : '#1f2937';
        ctx.fillText(line || ' ', 80, y);
      });
      
      // Footer with metadata
      const footerY = canvas.height - 30;
      ctx.fillStyle = isDark ? '#374151' : '#e5e7eb';
      ctx.fillRect(0, footerY - 10, canvas.width, 40);
      
      ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280';
      ctx.font = '12px sans-serif';
      const timestamp = new Date().toLocaleString();
      ctx.fillText(`${lines.length} lines · ${code.length} characters · ${timestamp}`, padding, footerY + 10);
      
      // Convert to base64
      const base64 = canvas.toDataURL('image/png').split(',')[1];
      console.log(`✅ Screenshot captured: ${canvas.width}x${canvas.height}, ~${Math.round(base64.length * 0.75 / 1024)}KB`);
      
      return base64;
    } catch (error) {
      console.error('❌ Failed to capture code editor screenshot:', error);
      return null;
    }
  };

  const handleSubmit = async () => {
    if (code.trim()) {
      setIsCapturing(true);
      console.log('📝 Submitting code and capturing screenshot...');
      
      // Capture screenshot
      const screenshot = await captureCodeEditorScreenshot();
      
      if (screenshot && sessionId) {
        console.log('📤 Uploading code screenshot to backend...');
        
        try {
          const response = await fetch(apiUrl("/api/proctor/upload-code-snapshot"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: sessionId,
              screen_frame: screenshot
            })
          });
          
          if (response.ok) {
            const result = await response.json();
            if (result.success && result.url) {
              localStorage.setItem(`proctor_code_url_${sessionId}`, result.url);
              console.log('✅ Code screenshot saved:', result.url);
            }
          } else {
            console.error('❌ Failed to upload code screenshot:', response.status);
          }
        } catch (error) {
          console.error('❌ Error uploading code screenshot:', error);
        }
      }
      
      setIsCapturing(false);
      onSubmit(code, language);
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab key handling for indentation
    if (e.key === "Tab") {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const newCode = code.substring(0, start) + "    " + code.substring(end);
      setCode(newCode);
      
      // Set cursor position after tab
      setTimeout(() => {
        e.currentTarget.selectionStart = e.currentTarget.selectionEnd = start + 4;
      }, 0);
    }
  };

  if (!isOpen) return null;

  const bgColor = isDark ? "bg-gray-900" : "bg-white";
  const textColor = isDark ? "text-gray-100" : "text-gray-900";
  const borderColor = isDark ? "border-gray-700" : "border-gray-300";
  const editorBg = isDark ? "bg-gray-800" : "bg-gray-50";
  const selectBg = isDark ? "bg-gray-700" : "bg-white";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div
        className={`relative w-[80vw] h-[80vh] rounded-lg shadow-2xl ${bgColor} ${textColor} flex flex-col`}
        style={{ maxWidth: "1400px", maxHeight: "900px" }}
      >
        {/* Header */}
        <div className={`flex items-center justify-between p-4 border-b ${borderColor}`}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                />
              </svg>
              <h2 className="text-xl font-semibold">Code Editor</h2>
            </div>
            
            {/* Language Selector */}
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className={`ml-4 px-3 py-1.5 rounded border ${borderColor} ${selectBg} ${textColor} focus:outline-none focus:ring-2 focus:ring-${accentColor}-500`}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            {/* Theme Toggle */}
            <button
              onClick={() => setIsDark(!isDark)}
              className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors`}
              title="Toggle Theme"
            >
              {isDark ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              )}
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors`}
              title="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Code Editor */}
        <div ref={editorContainerRef} className="flex-1 p-4 overflow-hidden">
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Write your ${language} code here...\n\nTips:\n- Press Tab for indentation\n- Your code is auto-saved\n- Click "Done" to submit`}
            className={`w-full h-full p-4 rounded border ${borderColor} ${editorBg} ${textColor} font-mono text-sm focus:outline-none focus:ring-2 focus:ring-${accentColor}-500 resize-none`}
            style={{
              lineHeight: "1.6",
              tabSize: 4,
            }}
            spellCheck={false}
          />
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-between p-4 border-t ${borderColor}`}>
          <div className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}>
            {code.length > 0 ? (
              <>
                {code.split("\n").length} lines · {code.length} characters
              </>
            ) : (
              "Start typing your code..."
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className={`px-4 py-2 rounded border ${borderColor} ${textColor} hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors`}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!code.trim() || isCapturing}
              className={`px-6 py-2 rounded text-white transition-colors flex items-center gap-2 ${
                code.trim() && !isCapturing
                  ? `bg-${accentColor}-600 hover:bg-${accentColor}-700`
                  : "bg-gray-400 cursor-not-allowed"
              }`}
              style={{
                backgroundColor: (code.trim() && !isCapturing) ? `var(--lk-theme-color)` : undefined,
              }}
            >
              {isCapturing && (
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {isCapturing ? 'Saving...' : 'Done'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

