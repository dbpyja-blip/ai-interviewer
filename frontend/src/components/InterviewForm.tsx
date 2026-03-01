import { motion } from "framer-motion";
import React, { useState } from "react";
import { apiUrl } from "@/config";
import { Button } from "./button/Button";

type InterviewFormProps = {
  accentColor: string;
  onSubmit: (formData: FormData) => void;
  onBack: () => void;
};

type FormData = {
  fullName: string;
  email: string;
  phone: string;
  position: string;
  experience: string;
  resumeFile: File | null;
};

export const InterviewForm = ({ accentColor, onSubmit, onBack }: InterviewFormProps) => {
  const [formData, setFormData] = useState<FormData>({
    fullName: "",
    email: "",
    phone: "",
    position: "",
    experience: "",
    resumeFile: null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setFormData(prev => ({
      ...prev,
      resumeFile: file,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      // Generate a brand-new session ID for every interview attempt.
      // crypto.randomUUID() is built into modern browsers and Node.js — no extra package needed.
      // This ensures each user — and each reload — gets completely isolated data
      // in the backend (separate room, separate proctoring folder, separate KMS file).
      // The ID is stored in localStorage so useConnection and the Playground can
      // read it without it ever appearing in the URL.
      const sessionId = crypto.randomUUID();
      localStorage.setItem("currentSessionId", sessionId);
      console.log(`🆔 New session ID generated: ${sessionId}`);

      // Prepare resume metadata (no file upload, just metadata)
      let resumeFileName = null;
      let resumeFilePath = null;
      
      if (formData.resumeFile) {
        resumeFileName = formData.resumeFile.name;
        console.log('Resume file selected:', resumeFileName);
      }
      
      // Send data to FastAPI backend for AI personalization.
      // Include the session_id so the backend can associate candidate data
      // with the correct LiveKit room from the start.
      try {
        const backendData = {
          session_id: sessionId,   // ties this submission to the LiveKit room
          fullName: formData.fullName,
          email: formData.email,
          phone: formData.phone,
          position: formData.position,
          experience: formData.experience,
          resumeFileName: resumeFileName,
          resumeFilePath: resumeFilePath,
        };

        const backendResponse = await fetch(apiUrl("/api/candidate-data"), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(backendData),
        });

        if (backendResponse.ok) {
          const result = await backendResponse.json();
          console.log('Data sent to AI backend successfully:', result);
        } else {
          console.warn('Failed to send data to AI backend, continuing anyway');
        }
      } catch (backendError) {
        console.warn('Error sending data to AI backend:', backendError);
        // Continue even if backend call fails
      }
      
      // Store candidate data (including session_id) in localStorage for the results page.
      try {
        const candidateDataForStorage = {
          session_id: sessionId,
          fullName: formData.fullName,
          email: formData.email,
          phone: formData.phone,
          position: formData.position,
          experience: formData.experience,
          resumeFileName: resumeFileName,
          resumeFilePath: resumeFilePath,
        };
        localStorage.setItem("currentCandidateData", JSON.stringify(candidateDataForStorage));
        
        // Store resume data if available
        if (formData.resumeFile) {
          const resumeInfo = {
            name: formData.resumeFile.name,
            size: formData.resumeFile.size,
            type: formData.resumeFile.type,
            path: resumeFilePath
          };
          localStorage.setItem("currentResumeData", JSON.stringify(resumeInfo));
        }
      } catch (storageError) {
        console.warn('Failed to store data in localStorage:', storageError);
      }
      
      // Proceed to interview
      onSubmit(formData);
    } catch (error) {
      console.error('Unexpected error:', error);
      alert('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = formData.fullName && formData.email && formData.position && formData.experience;

  return (
    <div className="flex left-0 top-0 w-full h-full bg-white text-gray-900 dark:bg-black dark:text-white items-center justify-center text-center repeating-square-background" style={{ paddingTop: '300px' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="flex flex-col items-center justify-center max-w-2xl mx-auto px-8 w-full"
      >
        {/* Header */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="mb-8"
        >
          <h1 className={`text-4xl md:text-5xl font-bold text-${accentColor}-500 dark:drop-shadow-${accentColor} mb-4`}>
            Interview Setup
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 max-w-lg mx-auto leading-relaxed">
            Tell us about yourself to personalize your mock interview experience
          </p>
        </motion.div>

        {/* Form */}
        <motion.form
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          onSubmit={handleSubmit}
          className="w-full max-w-lg space-y-6"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Full Name */}
            <div className="md:col-span-2">
              <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 text-left">
                Full Name *
              </label>
              <input
                type="text"
                id="fullName"
                name="fullName"
                value={formData.fullName}
                onChange={handleInputChange}
                className="w-full px-4 py-3 bg-white text-gray-900 border border-gray-300 rounded-lg placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200 dark:bg-gray-900 dark:text-white dark:border-gray-700"
                placeholder="Enter your full name"
                required
              />
            </div>

            {/* Email */}
            <div className="md:col-span-2">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 text-left">
                Email Address *
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                className="w-full px-4 py-3 bg-white text-gray-900 border border-gray-300 rounded-lg placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200 dark:bg-gray-900 dark:text-white dark:border-gray-700"
                placeholder="Enter your email address"
                required
              />
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 text-left">
                Phone Number
              </label>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                className="w-full px-4 py-3 bg-white text-gray-900 border border-gray-300 rounded-lg placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200 dark:bg-gray-900 dark:text-white dark:border-gray-700"
                placeholder="(555) 123-4567"
              />
            </div>

            {/* Position */}
            <div>
              <label htmlFor="position" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 text-left">
                Position Applying For *
              </label>
              <select
                id="position"
                name="position"
                value={formData.position}
                onChange={handleInputChange}
                className="w-full px-4 py-3 bg-white text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200 dark:bg-gray-900 dark:text-white dark:border-gray-700"
                required
              >
                <option value="">Select a position</option>
                <option value="software-engineer">Software Engineer</option>
                <option value="frontend-developer">Frontend Developer</option>
                <option value="backend-developer">Backend Developer</option>
                <option value="full-stack-developer">Full Stack Developer</option>
                <option value="data-scientist">Data Scientist</option>
                <option value="product-manager">Product Manager</option>
                <option value="ui-ux-designer">UI/UX Designer</option>
                <option value="devops-engineer">DevOps Engineer</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* Experience Level */}
            <div className="md:col-span-2">
              <label htmlFor="experience" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 text-left">
                Experience Level *
              </label>
              <select
                id="experience"
                name="experience"
                value={formData.experience}
                onChange={handleInputChange}
                className="w-full px-4 py-3 bg-white text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200 dark:bg-gray-900 dark:text-white dark:border-gray-700"
                required
              >
                <option value="">Select your experience level</option>
                <option value="entry-level">Entry Level (0-2 years)</option>
                <option value="mid-level">Mid Level (2-5 years)</option>
                <option value="senior-level">Senior Level (5-10 years)</option>
                <option value="lead-level">Lead Level (10+ years)</option>
              </select>
            </div>

            {/* Resume Upload */}
            <div className="md:col-span-2">
              <label htmlFor="resume" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 text-left">
                Resume Upload
              </label>
              <div className="relative">
                <input
                  type="file"
                  id="resume"
                  name="resume"
                  onChange={handleFileChange}
                  accept=".pdf,.doc,.docx"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className={`w-full px-4 py-3 bg-white border-2 border-dashed border-gray-300 rounded-lg text-center transition-all duration-200 hover:border-${accentColor}-500 hover:bg-gray-50 dark:bg-gray-900 dark:border-gray-700 dark:hover:bg-gray-800`}>
                  <div className="flex flex-col items-center">
                    <svg className={`w-8 h-8 text-${accentColor}-500 mb-2`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      {formData.resumeFile ? (
                        <span className="text-green-400">✓ {formData.resumeFile.name}</span>
                      ) : (
                        "Click to upload your resume (PDF, DOC, DOCX)"
                      )}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Optional but recommended</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="flex flex-col sm:flex-row gap-4 pt-6"
          >
            <Button
              type="button"
              accentColor={accentColor}
              variant="icon"
              className="flex-1 px-6 py-3 text-base font-medium rounded-lg border border-gray-700 hover:border-gray-600 transition-all duration-200"
              onClick={onBack}
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </Button>
            
            <Button
              type="submit"
              accentColor={accentColor}
              className={`flex-1 px-6 py-3 text-base font-medium rounded-lg transition-all duration-200 transform hover:scale-105 ${
                !isFormValid || isSubmitting 
                  ? "opacity-50 cursor-not-allowed" 
                  : "dark:shadow-lg-cyan dark:hover:shadow-cyan"
              }`}
              disabled={!isFormValid || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Starting Interview...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Start Interview
                </>
              )}
            </Button>
          </motion.div>
        </motion.form>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.6 }}
          className="mt-8 text-sm text-gray-500"
        >
          <p>Your information will be used to personalize the interview questions and experience.</p>
        </motion.div>
      </motion.div>
    </div>
  );
};
