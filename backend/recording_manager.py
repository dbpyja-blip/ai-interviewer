"""
================================================================================
Recording Manager for Udemy-style Segmented Video Recording
================================================================================

This module handles:
- LiveKit Egress recording setup
- Interview phase detection and timestamp tracking
- Video segmentation using FFmpeg
- Transcript storage with timestamps
- Local storage management for recordings

PHASES:
- introduction: Initial greeting and candidate introduction
- technical: Technical/conceptual questions
- coding: Coding problem and solution review
- behavioral: HR/behavioral questions
"""

import os
import json
import subprocess
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
from pathlib import Path

logger = logging.getLogger("skillcef.recording")

# Phase definitions
PHASES = {
    "introduction": {
        "name": "Introduction",
        "duration_estimate": "2-3 minutes",
        "description": "Initial greeting and candidate introduction"
    },
    "technical": {
        "name": "Technical Questions",
        "duration_estimate": "5-7 minutes",
        "description": "Technical/conceptual questions based on role"
    },
    "coding": {
        "name": "Coding Question",
        "duration_estimate": "10-15 minutes",
        "description": "Coding problem and solution review"
    },
    "behavioral": {
        "name": "HR/Behavioral Questions",
        "duration_estimate": "5-7 minutes",
        "description": "Behavioral and situational questions"
    }
}


class PhaseTracker:
    """Track interview phases with timestamps"""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.current_phase = "introduction"
        self.phase_start_time = datetime.now().timestamp()
        self.phase_transitions: List[Dict[str, Any]] = []
        
        # Record initial phase
        self.record_phase_transition("introduction", "Interview started")
    
    def record_phase_transition(self, new_phase: str, reason: str = ""):
        """Record a phase transition with timestamp"""
        if new_phase == self.current_phase:
            return  # No change
        
        # Calculate duration of previous phase
        previous_duration = datetime.now().timestamp() - self.phase_start_time
        
        transition = {
            "from_phase": self.current_phase,
            "to_phase": new_phase,
            "timestamp": datetime.now().timestamp(),
            "previous_duration_seconds": previous_duration,
            "reason": reason
        }
        
        self.phase_transitions.append(transition)
        logger.info(f"   📊 Phase transition: {self.current_phase} → {new_phase} (Duration: {previous_duration:.1f}s)")
        if reason:
            logger.info(f"      Reason: {reason[:60]}")
        
        self.current_phase = new_phase
        self.phase_start_time = datetime.now().timestamp()
    
    def get_phase_timestamps(self) -> List[Dict[str, Any]]:
        """Get all phase transitions with timestamps"""
        return self.phase_transitions.copy()
    
    def detect_phase_from_message(self, message: str, is_agent: bool) -> Optional[str]:
        """
        Detect phase transition based on message content.
        This is a simple heuristic - can be enhanced with LLM classification.
        """
        message_lower = message.lower()
        
        # Introduction phase indicators
        if any(keyword in message_lower for keyword in ["introduce yourself", "tell me about", "background", "welcome", "greet"]):
            if is_agent:
                return "introduction"
        
        # Technical phase indicators
        if any(keyword in message_lower for keyword in ["algorithm", "data structure", "system design", "how would you", "explain", "technical"]):
            if is_agent:
                return "technical"
        
        # Coding phase indicators
        if any(keyword in message_lower for keyword in ["write a function", "code", "programming", "solution", "implement", "coding brackets"]):
            if is_agent:
                return "coding"
        
        # Behavioral phase indicators
        if any(keyword in message_lower for keyword in ["tell me about a time", "situation", "challenge", "teamwork", "behavioral", "hr"]):
            if is_agent:
                return "behavioral"
        
        return None


class RecordingManager:
    """Manage video recording, segmentation, and storage"""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.recordings_dir = Path("recordings") / session_id
        self.recordings_dir.mkdir(parents=True, exist_ok=True)
        self.phase_tracker = PhaseTracker(session_id)
        self.recording_started = False
        self.egress_id: Optional[str] = None
        
    def start_recording(self, room_name: str, livekit_url: str, api_key: str, api_secret: str):
        """
        Start LiveKit Egress recording.
        Note: This requires LiveKit Egress service to be running.
        For now, we rely on frontend MediaRecorder API for recording.
        """
        try:
            # Try to use LiveKit Egress if available
            from livekit.api import LiveKitAPI
            
            api = LiveKitAPI(livekit_url, api_key, api_secret)
            
            # Check if egress is available (may not be in all LiveKit versions)
            if hasattr(api, 'egress'):
                egress_client = api.egress
                
                # Create room composite egress (records entire room)
                egress_request = {
                    "room_name": room_name,
                    "layout": "speaker",
                    "outputs": [
                        {
                            "file": {
                                "filepath": f"recordings/{self.session_id}/full_recording.mp4",
                                "file_type": "MP4",
                                "video_codec": "H264",
                                "audio_codec": "AAC",
                            }
                        }
                    ]
                }
                
                # Start egress recording
                egress_info = egress_client.start_room_composite_egress(**egress_request)
                self.egress_id = egress_info.egress_id
                self.recording_started = True
                
                logger.info(f"🎥 Recording started: Egress ID {self.egress_id}")
                return True
            else:
                # Egress not available, use frontend recording
                logger.info("LiveKit Egress not available, using frontend MediaRecorder")
                return False
            
        except Exception as e:
            logger.warning(f"LiveKit Egress not available: {e}")
            # Fallback: Record locally using browser MediaRecorder API (handled in frontend)
            logger.info("Using frontend MediaRecorder API for recording")
            return False
    
    def stop_recording(self):
        """Stop the recording"""
        if not self.recording_started or not self.egress_id:
            return
        
        try:
            from livekit.api import LiveKitAPI
            # Stop egress recording
            # Implementation depends on LiveKit API version
            logger.info(f"🛑 Stopping recording: Egress ID {self.egress_id}")
            self.recording_started = False
        except Exception as e:
            logger.error(f"Failed to stop recording: {e}")
    
    def analyze_transcripts_with_ai(self, transcripts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Use OpenAI GPT-4o-mini to analyze transcripts and detect phase transitions.
        This provides more accurate segmentation than keyword matching.
        """
        if not transcripts or len(transcripts) == 0:
            logger.warning("No transcripts available for AI analysis")
            return []
        
        try:
            from openai import OpenAI
            
            # Check if OpenAI API key is available
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                logger.warning("OPENAI_API_KEY not set, using keyword-based phase detection")
                return []
            
            client = OpenAI(api_key=api_key)
            
            # Prepare transcript text with timestamps
            # Convert absolute timestamps to relative (seconds from start)
            transcript_text = ""
            if transcripts and len(transcripts) > 0:
                # Get the first timestamp as the baseline (recording start)
                first_timestamp = min(entry.get("timestamp", 0) for entry in transcripts)
                last_timestamp = max(entry.get("timestamp", 0) for entry in transcripts)
                
                # Calculate interview duration
                interview_duration = (last_timestamp - first_timestamp) / 1000  # Convert ms to seconds
                
                for entry in transcripts:
                    speaker = "Agent" if not entry.get("is_self", False) else "Candidate"
                    # Convert to relative seconds from start
                    relative_sec = (entry.get("timestamp", 0) - first_timestamp) / 1000
                    transcript_text += f"[{relative_sec:.1f}s] {speaker}: {entry.get('message', '')}\n"
            else:
                interview_duration = 0
            
            # Use GPT-4o-mini to detect phase transitions and generate custom titles
            prompt = f"""Analyze this interview transcript and identify phase transitions with custom titles.

**IMPORTANT: The interview duration is {interview_duration:.1f} seconds. All timestamps MUST be between 0 and {interview_duration:.1f}.**

The interview typically has these phases:
1. Introduction - Greeting, introductions, background discussion
2. Technical - Technical questions about algorithms, data structures, system design
3. Coding - Coding problems and code review
4. Behavioral - HR/behavioral questions, teamwork, challenges

For each phase transition, provide:
- "timestamp": timestamp in seconds when this phase segment starts
- "phase": phase type (introduction, technical, coding, behavioral)
- "title": A descriptive, specific title for this segment (e.g., "Discussing Hash Tables and Time Complexity", "Implementing String Reversal Function", "Sharing Experience with Team Conflicts")
- "reason": brief reason for the transition

The title should be:
- Specific to the content discussed in that segment
- Professional and descriptive
- 3-8 words long
- Suitable as a filename (no special characters except hyphens and underscores)

Transcript:
{transcript_text[:8000]}  # Limit to avoid token limits

Return ONLY valid JSON array, no other text. Example format:
[
  {{"timestamp": 0, "phase": "introduction", "title": "Welcome and Candidate Introduction", "reason": "Interview begins"}},
  {{"timestamp": 120, "phase": "technical", "title": "Discussing Data Structures and Algorithms", "reason": "Moving to technical questions"}},
  {{"timestamp": 420, "phase": "coding", "title": "Implementing Palindrome Check Function", "reason": "Coding problem presented"}},
  {{"timestamp": 780, "phase": "behavioral", "title": "Sharing Teamwork and Challenge Experiences", "reason": "Behavioral questions start"}}
]"""

            response = client.chat.completions.create(
                model="gpt-4o-mini",  # Using only GPT-4o-mini as requested
                messages=[
                    {"role": "system", "content": "You are an expert at analyzing interview transcripts. Return only valid JSON arrays."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=500
            )
            
            import json
            result_text = response.choices[0].message.content.strip()
            
            # Clean up JSON (remove markdown code blocks if present)
            if result_text.startswith("```"):
                result_text = result_text.split("```")[1]
                if result_text.startswith("json"):
                    result_text = result_text[4:]
                result_text = result_text.strip()
            
            transitions = json.loads(result_text)
            
            # Validate timestamps are within interview duration
            valid_transitions = []
            for transition in transitions:
                ts = transition.get("timestamp", 0)
                # Cap timestamp to interview duration
                if ts > interview_duration:
                    logger.warning(f"      ⚠️ AI returned timestamp {ts:.1f}s exceeds interview duration {interview_duration:.1f}s, capping it")
                    transition["timestamp"] = min(ts, interview_duration)
                valid_transitions.append(transition)
            
            transitions = valid_transitions
            
            # Validate and clean titles for use as filenames
            for transition in transitions:
                if "title" in transition:
                    # Clean title for filename: remove special chars, replace spaces with underscores
                    title = transition["title"]
                    # Remove or replace invalid filename characters
                    title = "".join(c if c.isalnum() or c in (' ', '-', '_') else '_' for c in title)
                    title = title.replace(' ', '_')  # Replace spaces with underscores
                    title = title[:50]  # Limit length
                    transition["title_clean"] = title
                else:
                    # Generate title from phase if not provided
                    phase = transition.get("phase", "unknown")
                    transition["title"] = PHASES.get(phase, {}).get("name", phase.title())
                    transition["title_clean"] = phase
            
            logger.info(f"   🤖 AI detected {len(transitions)} phase transitions with custom titles using GPT-4o-mini")
            for i, t in enumerate(transitions):
                logger.info(f"      Segment {i+1}: '{t.get('title', 'N/A')}' at {t.get('timestamp', 0):.1f}s")
            return transitions
            
        except Exception as e:
            logger.warning(f"AI phase detection failed: {e}, falling back to keyword detection")
            return []
    
    def segment_video(self, video_path: str, output_dir: Optional[str] = None, transcripts: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
        """
        Segment video into phases using FFmpeg based on phase timestamps.
        Uses AI (GPT-4o-mini) to analyze transcripts for accurate phase detection.
        
        Args:
            video_path: Path to the full recording
            output_dir: Directory to save segments (default: recordings/session_id/segments)
            transcripts: Optional list of transcripts for AI-based phase detection
        
        Returns:
            List of segment metadata dictionaries
        """
        if not os.path.exists(video_path):
            logger.error(f"Video file not found: {video_path}")
            return []
        
        if output_dir is None:
            output_dir = self.recordings_dir / "segments"
        else:
            output_dir = Path(output_dir)
        
        output_dir.mkdir(parents=True, exist_ok=True)
        
        segments = []
        
        # Try AI-based phase detection first if transcripts are available
        ai_transitions = []
        if transcripts and len(transcripts) > 0:
            logger.info("   🤖 Analyzing transcripts with GPT-4o-mini for phase detection...")
            ai_transitions = self.analyze_transcripts_with_ai(transcripts)
        
        # Use AI transitions if available, otherwise fall back to tracked transitions
        if ai_transitions and len(ai_transitions) > 0:
            phase_transitions = ai_transitions
            logger.info(f"   ✅ Using AI-detected phase transitions: {len(phase_transitions)}")
        else:
            phase_transitions = self.phase_tracker.get_phase_timestamps()
            if phase_transitions:
                logger.info(f"   ✅ Using tracked phase transitions: {len(phase_transitions)}")
            else:
                logger.warning("   ⚠️  No phase transitions found, creating single segment for entire video")
                # Create one segment for entire video - will be handled below
                phase_transitions = []
                normalized_transitions = []
        
        # Get video duration using multiple methods
        # Method 1: Try ffprobe with format duration
        total_duration = 0.0
        duration_method = None
        
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)],
                capture_output=True,
                text=True,
                check=False,  # Don't raise exception on non-zero exit
                timeout=10
            )
            duration_str = result.stdout.strip()
            if duration_str and duration_str != "N/A" and duration_str.lower() != "nan" and duration_str != "":
                try:
                    total_duration = float(duration_str)
                    if total_duration > 0:
                        duration_method = "ffprobe"
                        logger.info(f"   📹 Video duration (ffprobe): {total_duration:.1f} seconds")
                except ValueError:
                    pass
        except Exception as e:
            logger.warning(f"   ⚠️ ffprobe method failed: {e}")
        
        # Method 2: If ffprobe failed, try parsing ffmpeg output for Duration field
        if total_duration <= 0:
            try:
                logger.info("   🔄 Trying ffmpeg to extract duration...")
                result = subprocess.run(
                    ["ffmpeg", "-i", str(video_path)],
                    capture_output=True,
                    text=True,
                    check=False,  # ffmpeg returns non-zero when no output file specified
                    timeout=10
                )
                # Parse duration from ffmpeg stderr output (format: Duration: HH:MM:SS.cc)
                import re
                ffmpeg_output = result.stderr if result.stderr else ""
                duration_match = re.search(r'Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})', ffmpeg_output)
                if duration_match:
                    hours, minutes, seconds, centiseconds = map(int, duration_match.groups())
                    total_duration = hours * 3600 + minutes * 60 + seconds + centiseconds / 100
                    duration_method = "ffmpeg"
                    logger.info(f"   📹 Video duration (ffmpeg): {total_duration:.1f} seconds")
                else:
                    # Try without centiseconds
                    duration_match = re.search(r'Duration:\s*(\d{2}):(\d{2}):(\d{2})', ffmpeg_output)
                    if duration_match:
                        hours, minutes, seconds = map(int, duration_match.groups())
                        total_duration = hours * 3600 + minutes * 60 + seconds
                        duration_method = "ffmpeg"
                        logger.info(f"   📹 Video duration (ffmpeg): {total_duration:.1f} seconds")
            except Exception as e:
                logger.warning(f"   ⚠️ ffmpeg parsing failed: {e}")
        
        # Method 3: Estimate from transcript timestamps (most reliable for webm from browser)
        if total_duration <= 0 and transcripts and len(transcripts) > 0:
            try:
                logger.info("   🔄 Estimating duration from transcript timestamps...")
                # Get the latest transcript timestamp
                latest_timestamp = max(t.get("timestamp", 0) for t in transcripts)
                # Get the earliest (first non-zero) timestamp
                earliest_timestamp = min((t.get("timestamp", latest_timestamp) for t in transcripts if t.get("timestamp", 0) > 0), default=0)
                
                # Convert to seconds if in milliseconds (timestamps > 10000 are likely milliseconds)
                if latest_timestamp > 10000:
                    latest_timestamp_sec = latest_timestamp / 1000
                    earliest_timestamp_sec = earliest_timestamp / 1000
                else:
                    latest_timestamp_sec = latest_timestamp
                    earliest_timestamp_sec = earliest_timestamp
                
                # Estimate duration: span of timestamps + 10 second buffer for ending
                total_duration = (latest_timestamp_sec - earliest_timestamp_sec) + 10
                if total_duration > 0:
                    duration_method = "transcripts"
                    logger.info(f"   📹 Video duration (from transcripts): {total_duration:.1f} seconds (from {earliest_timestamp_sec:.1f}s to {latest_timestamp_sec:.1f}s + 10s buffer)")
            except Exception as e:
                logger.warning(f"   ⚠️ Transcript duration estimation failed: {e}")
        
        # Method 4: Estimate from file size as last resort
        if total_duration <= 0:
            try:
                logger.info("   🔄 Estimating duration from file size...")
                file_size_mb = video_path.stat().st_size / (1024 * 1024)
                # Rough estimate: 1 MB ≈ 6-10 seconds for webm video (depends on quality)
                # Using 7 seconds per MB as middle ground
                total_duration = file_size_mb * 7
                duration_method = "filesize"
                logger.warning(f"   ⚠️ Video duration (estimated from file size): {total_duration:.1f}s ({file_size_mb:.1f} MB)")
            except Exception as e:
                logger.error(f"   ❌ File size estimation failed: {e}")
        
        # Final validation
        if total_duration <= 0:
            logger.error("   ❌ Could not determine video duration using any method")
            return []
        
        logger.info(f"   ✅ Using duration from {duration_method}: {total_duration:.2f}s")
        
        # Segment based on phase transitions
        start_time = 0.0
        segment_index = 0
        
        # Normalize timestamps - AI returns seconds, tracked transitions return absolute timestamps
        normalized_transitions = []
        recording_start = self.phase_tracker.phase_start_time if hasattr(self.phase_tracker, 'phase_start_time') else 0
        
        for transition in phase_transitions:
            # AI transitions have "timestamp" in seconds, tracked transitions have absolute timestamp
            if "timestamp" in transition:
                ts = transition["timestamp"]
                
                # Detect timestamp type and normalize to relative seconds from video start
                # 1. If timestamp is VERY large (> 1000000000), it's an absolute Unix timestamp
                if ts > 1000000000:
                    # Absolute timestamp (e.g., 1766777062) - convert to relative
                    ts = ts - recording_start
                    logger.info(f"      Converted absolute timestamp {transition['timestamp']} to relative: {ts:.1f}s")
                # 2. If timestamp is large but not Unix (> 100000), it's in milliseconds
                elif ts > 100000:
                    # Convert milliseconds to seconds
                    ts = ts / 1000
                    logger.info(f"      Converted timestamp from ms to seconds: {ts:.1f}s")
                # 3. Otherwise, it's already in relative seconds (e.g., 165, 238) - use as-is
                else:
                    logger.info(f"      Using relative timestamp: {ts:.1f}s")
                
                # Safety check: ensure timestamp is within video duration (with some tolerance)
                if ts > total_duration + 60:
                    logger.warning(f"      ⚠️ Timestamp {ts:.1f}s exceeds video duration {total_duration:.1f}s, capping it")
                    ts = min(ts, total_duration - 1)
                
                normalized_transitions.append({
                    "timestamp": max(0, ts),  # Ensure non-negative
                    "phase": transition.get("to_phase") or transition.get("phase"),
                    "title": transition.get("title", ""),
                    "title_clean": transition.get("title_clean", transition.get("phase", "segment")),
                    "reason": transition.get("reason", "")
                })
        
        # Sort transitions by timestamp
        normalized_transitions.sort(key=lambda x: x["timestamp"])
        
        for i, transition in enumerate(normalized_transitions):
            end_time = transition["timestamp"]
            
            # Calculate duration first
            duration = end_time - start_time
            
            # Skip segments with 0 or very small duration (< 1 second)
            if duration < 1.0:
                logger.warning(f"   ⚠️ Skipping segment {segment_index} with duration {duration:.1f}s (too short)")
                start_time = end_time  # Update start_time for next segment
                continue
            
            # Get phase info and title
            phase_key = transition.get("phase") or transition.get("to_phase", "unknown")
            phase_info = PHASES.get(phase_key, {"name": phase_key.title()})
            
            # Use AI-generated title for filename, or fallback to phase name
            segment_title = transition.get("title_clean") or transition.get("title") or phase_key
            # Ensure title is safe for filename
            segment_title = "".join(c if c.isalnum() or c in ('-', '_') else '_' for c in segment_title)
            segment_title = segment_title[:50]  # Limit length
            
            segment_filename = f"segment_{segment_index:02d}_{segment_title}.mp4"
            segment_path = output_dir / segment_filename
            
            # Extract segment using FFmpeg
            try:
                # Re-encode to ensure audio is preserved in segments
                subprocess.run(
                    [
                        "ffmpeg", "-i", str(video_path),
                        "-ss", str(start_time),
                        "-t", str(end_time - start_time),
                        "-c:v", "libx264",  # Re-encode video
                        "-c:a", "aac",      # Re-encode audio to AAC
                        "-b:a", "192k",     # Audio bitrate
                        "-strict", "experimental",
                        "-movflags", "+faststart",
                        str(segment_path),
                        "-y"  # Overwrite if exists
                    ],
                    check=True,
                    capture_output=True,
                    timeout=300
                )
                
                # Get display title (AI-generated or phase name)
                display_title = transition.get("title") or phase_info["name"]
                
                segments.append({
                    "index": segment_index,
                    "phase": phase_key,
                    "phase_name": phase_info["name"],
                    "title": display_title,  # AI-generated title
                    "start_time": start_time,
                    "end_time": end_time,
                    "duration": end_time - start_time,
                    "file_path": str(segment_path),
                    "file_name": segment_filename
                })
                
                logger.info(f"   ✅ Segment {segment_index}: '{display_title}' ({start_time:.1f}s - {end_time:.1f}s, {end_time - start_time:.1f}s)")
                
            except subprocess.CalledProcessError as e:
                logger.error(f"Failed to create segment {segment_index}: {e}")
            
            start_time = end_time
            segment_index += 1
        
        # If no transitions were found, create single segment for entire video
        if not normalized_transitions and len(segments) == 0:
            logger.info("   📦 Creating single segment for entire video (no phase transitions detected)")
            phase_key = "full_interview"
            segment_title = "Full_Interview_Recording"
            segment_filename = f"segment_00_{segment_title}.mp4"
            segment_path = output_dir / segment_filename
            
            try:
                # Use re-encoding for WebM files to ensure compatibility
                logger.info(f"   🔄 Converting WebM to MP4 segment...")
                subprocess.run(
                    [
                        "ffmpeg", "-i", str(video_path),
                        "-c:v", "libx264",  # Re-encode video to H.264
                        "-c:a", "aac",      # Re-encode audio to AAC
                        "-strict", "experimental",
                        "-b:a", "192k",
                        "-movflags", "+faststart",
                        str(segment_path),
                        "-y"
                    ],
                    check=True,
                    capture_output=True,
                    timeout=300  # 5 minute timeout
                )
                
                segments.append({
                    "index": 0,
                    "phase": phase_key,
                    "phase_name": "Full Interview",
                    "title": "Full Interview Recording",
                    "start_time": 0.0,
                    "end_time": total_duration,
                    "duration": total_duration,
                    "file_path": str(segment_path),
                    "file_name": segment_filename
                })
                
                logger.info(f"   ✅ Created single segment: 'Full Interview Recording' (0.0s - {total_duration:.1f}s)")
            except subprocess.CalledProcessError as e:
                logger.error(f"Failed to create single segment: {e}")
                if hasattr(e, 'stderr') and e.stderr:
                    try:
                        error_msg = e.stderr.decode('utf-8', errors='ignore')[:500]
                        logger.error(f"FFmpeg error: {error_msg}")
                    except:
                        logger.error(f"FFmpeg error (could not decode): {e.stderr}")
            except subprocess.TimeoutExpired:
                logger.error("FFmpeg timed out while creating segment")
        
        # Create final segment (from last transition to end)
        elif start_time < total_duration:
            # Calculate final segment duration
            final_duration = total_duration - start_time
            
            # Skip if final segment is too short (< 2 seconds)
            if final_duration < 2.0:
                logger.info(f"   ⏭️ Skipping final segment (duration {final_duration:.1f}s is too short)")
            else:
                # Get the last phase from transitions, or use current phase
                if normalized_transitions:
                    last_transition = normalized_transitions[-1]
                    phase_key = last_transition.get("phase") or "unknown"
                    segment_title = last_transition.get("title_clean") or last_transition.get("title") or phase_key
                else:
                    phase_key = self.phase_tracker.current_phase
                    segment_title = phase_key
                phase_info = PHASES.get(phase_key, {"name": phase_key.title()})
                
                # Clean title for filename
                segment_title = "".join(c if c.isalnum() or c in ('-', '_') else '_' for c in segment_title)
                segment_title = segment_title[:50]
                
                segment_filename = f"segment_{segment_index:02d}_{segment_title}.mp4"
                segment_path = output_dir / segment_filename
                
                try:
                    subprocess.run(
                        [
                            "ffmpeg", "-i", video_path,
                            "-ss", str(start_time),
                            "-c", "copy",
                            "-avoid_negative_ts", "make_zero",
                            str(segment_path),
                            "-y"
                        ],
                        check=True,
                        capture_output=True
                    )
                    
                    # Get display title
                    if normalized_transitions:
                        display_title = normalized_transitions[-1].get("title") or phase_info["name"]
                    else:
                        display_title = phase_info["name"]
                    
                    segments.append({
                        "index": segment_index,
                        "phase": phase_key,
                        "phase_name": phase_info["name"],
                        "title": display_title,  # AI-generated title
                        "start_time": start_time,
                        "end_time": total_duration,
                        "duration": total_duration - start_time,
                        "file_path": str(segment_path),
                        "file_name": segment_filename
                    })
                    
                    logger.info(f"   ✅ Final segment {segment_index}: '{display_title}' ({start_time:.1f}s - {total_duration:.1f}s, {total_duration - start_time:.1f}s)")
                    
                except subprocess.CalledProcessError as e:
                    logger.error(f"Failed to create final segment: {e}")
        
        return segments
    
    def save_metadata(self, segments: List[Dict[str, Any]], transcripts: List[Dict[str, Any]]):
        """Save recording metadata to JSON file"""
        metadata = {
            "session_id": self.session_id,
            "recording_started": datetime.now().isoformat(),
            "phases": self.phase_tracker.get_phase_timestamps(),
            "segments": segments,
            "transcripts": transcripts,
            "total_segments": len(segments),
            "total_duration": sum(s["duration"] for s in segments)
        }
        
        metadata_path = self.recordings_dir / "metadata.json"
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
        
        logger.info(f"💾 Saved recording metadata: {metadata_path}")
        return metadata_path


# Global recording managers per session
recording_managers: Dict[str, RecordingManager] = {}


def get_recording_manager(session_id: str) -> RecordingManager:
    """Get or create recording manager for session"""
    if session_id not in recording_managers:
        recording_managers[session_id] = RecordingManager(session_id)
    return recording_managers[session_id]

