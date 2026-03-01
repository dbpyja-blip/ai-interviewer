"""
================================================================================
SkillCef Mock Interview Backend with FREE Local Proctoring
================================================================================

PROCTORING SYSTEM:
------------------
- Uses Hugging Face model: microsoft/conditional-detr-resnet-50
- Runs COMPLETELY LOCALLY - NO API COSTS!
- Model downloads ~170MB on first run (cached after that)
- Detects objects using COCO dataset (80 classes)

WHAT IT DETECTS:
----------------
✅ Multiple persons in frame (cheating detection)
✅ Cell phones (unauthorized devices)
✅ Laptops/computers (unauthorized devices)
✅ Books, tablets, monitors (reference materials)
✅ Returns bounding boxes with [x_min, y_min, x_max, y_max] coordinates
✅ Returns confidence scores for each detection

HOW IT WORKS:
-------------
1. Frontend sends images every 10 seconds to /api/vision-analyze
2. Backend runs local Hugging Face model (NO OpenAI API)
3. Model detects objects and returns bounding boxes
4. System flags red flags (multiple people, phones, etc.)
5. Results stored in vision_analysis_store for review

COST SAVINGS:
-------------
- Before: $0.01+ per image to OpenAI Vision API
- Now: $0.00 - completely FREE local processing!
- No internet needed for detection (after model download)

API ENDPOINTS:
--------------
- POST /api/vision-analyze - Analyze face/screen frames for proctoring
- POST /api/analyze-code-immediate - Check code submissions for violations
- GET /api/proctoring-status - Check if model is loaded
- GET /health - Health check with proctoring status

MODEL LOADS AT STARTUP:
-----------------------
When you run: python agent.py
The model automatically loads and is ready to detect objects!

================================================================================
"""

from dotenv import load_dotenv
import json
import os
import httpx
import asyncio
import logging
import traceback
from datetime import datetime
import time
from typing import Optional, List, Dict, Any
import textwrap
import shutil

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI as OpenAIHTTP

from livekit import agents, rtc
from livekit.agents import AgentSession, Agent
from livekit.plugins import (
    openai,
    noise_cancellation,
    silero,
)
from livekit.api import LiveKitAPI
from recording_manager import get_recording_manager, PHASES

# Image processing for LOCAL proctoring (FREE - no API costs!)
import base64
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont
import torch
import warnings
# Suppress PyTorch meta parameter warnings (they're harmless)
warnings.filterwarnings("ignore", message=".*copying from a non-meta parameter.*")
from transformers import AutoImageProcessor, ConditionalDetrForObjectDetection

# Load environment variables from .env file
load_dotenv()

# Global variable to store candidate data for the current session
current_candidate_data = None

# ==============================================================================
# PROCTORING MODEL - FREE LOCAL HUGGING FACE MODEL (NO API COSTS!)
# ==============================================================================
# Global variables for the proctoring model
proctoring_model = None
proctoring_processor = None
proctoring_model_loaded = False

# COCO classes that are relevant for proctoring
PROCTORING_CLASSES = {
    "person": "person",
    "cell phone": "cell phone", 
    "laptop": "laptop",
    "book": "book",
    "tv": "tv",
    "keyboard": "keyboard",
    "mouse": "mouse",
    "remote": "remote",
    "bottle": "bottle",
    "cup": "cup"
}

def load_proctoring_model():
    """
    Load the Hugging Face object detection model for proctoring.
    This runs LOCALLY and is completely FREE - no API costs!
    Model: microsoft/conditional-detr-resnet-50
    """
    global proctoring_model, proctoring_processor, proctoring_model_loaded
    
    if proctoring_model_loaded:
        logger.info("✅ Proctoring model already loaded")
        return True
    
    try:
        logger.info("=" * 80)
        logger.info("🚀 LOADING PROCTORING MODEL (FREE LOCAL MODEL - NO API COSTS)")
        logger.info("=" * 80)
        logger.info("Model: microsoft/conditional-detr-resnet-50")
        logger.info("This will download ~170MB on first run (cached after that)")
        logger.info("Starting download and initialization...")
        
        # Load the image processor
        proctoring_processor = AutoImageProcessor.from_pretrained(
            "microsoft/conditional-detr-resnet-50"
        )
        logger.info("✅ Image processor loaded successfully")
        
        # Load the model
        proctoring_model = ConditionalDetrForObjectDetection.from_pretrained(
            "microsoft/conditional-detr-resnet-50"
        )
        logger.info("✅ Object detection model loaded successfully")
        
        # Set model to evaluation mode
        proctoring_model.eval()
        logger.info("✅ Model set to evaluation mode")
        
        proctoring_model_loaded = True
        logger.info("=" * 80)
        logger.info("🎉 PROCTORING MODEL READY - ALL DETECTIONS ARE FREE!")
        logger.info("=" * 80)
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to load proctoring model: {e}")
        logger.error(traceback.format_exc())
        proctoring_model_loaded = False
        return False


def draw_bounding_boxes_on_image(image: Image.Image, detections: List[Dict[str, Any]]) -> Image.Image:
    """
    Draw bounding boxes on an image with labels and confidence scores.
    
    Args:
        image: PIL Image object
        detections: List of detections with labels, confidence, and bounding boxes
    
    Returns:
        PIL Image with bounding boxes drawn
    """
    # Create a copy to draw on
    annotated_image = image.copy()
    draw = ImageDraw.Draw(annotated_image)
    
    # Try to use a nice font, fallback to default if not available
    try:
        font = ImageFont.truetype("arial.ttf", 20)
    except:
        font = ImageFont.load_default()
    
    # Color mapping for different object types
    color_map = {
        "person": "#00FF00",  # Green
        "cell phone": "#FF0000",  # Red
        "laptop": "#FFA500",  # Orange
        "book": "#FFFF00",  # Yellow
        "tv": "#FF00FF",  # Magenta
    }
    
    for detection in detections:
        label = detection["label"]
        confidence = detection["confidence"]
        box = detection["bounding_box"]
        
        # Get color for this object type
        color = color_map.get(label, "#00FFFF")  # Cyan default
        
        # Draw bounding box
        draw.rectangle(
            [(box["x_min"], box["y_min"]), (box["x_max"], box["y_max"])],
            outline=color,
            width=4
        )
        
        # Draw label background
        label_text = f"{label} {confidence*100:.0f}%"
        
        # Get text size for background
        try:
            bbox = draw.textbbox((box["x_min"], box["y_min"] - 25), label_text, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
        except:
            # Fallback for older PIL versions
            text_width, text_height = 150, 25
        
        # Draw background rectangle for text
        draw.rectangle(
            [(box["x_min"], box["y_min"] - 25), (box["x_min"] + text_width + 10, box["y_min"])],
            fill=color
        )
        
        # Draw label text
        draw.text(
            (box["x_min"] + 5, box["y_min"] - 23),
            label_text,
            fill="black",
            font=font
        )
    
    return annotated_image


def save_annotated_image(image: Image.Image, session_id: str, frame_type: str, detections: List[Dict[str, Any]]) -> str:
    """
    Save an image with bounding boxes drawn on it.
    
    Args:
        image: PIL Image with bounding boxes
        session_id: Session identifier
        frame_type: Type of frame (face/screen)
        detections: List of detections
    
    Returns:
        URL path to the saved image
    """
    try:
        # Create session directory
        session_dir = os.path.join("proctoring", session_id)
        os.makedirs(session_dir, exist_ok=True)
        
        # Generate filename
        timestamp = int(datetime.now().timestamp() * 1000)
        filename = f"{frame_type}_detections_{timestamp}.jpg"
        file_path = os.path.join(session_dir, filename)
        
        # Save image
        image.save(file_path, "JPEG", quality=95)
        
        url = f"/proctoring/{session_id}/{filename}"
        logger.info(f"💾 Saved annotated image: {file_path}")
        logger.info(f"🔗 URL: {url}")
        
        return url
    except Exception as e:
        logger.error(f"Failed to save annotated image: {e}")
        return None


# OCR and text extraction functions removed - no longer using screen sharing or code extraction


def detect_objects_in_image(image_base64: str, confidence_threshold: float = 0.5) -> Dict[str, Any]:
    """
    Detect objects in an image using the local Hugging Face model.
    Returns bounding boxes and labels for detected objects.
    
    Args:
        image_base64: Base64 encoded image string
        confidence_threshold: Minimum confidence score for detections (default 0.5 - LOWERED FOR BETTER DETECTION)
    
    Returns:
        Dictionary with detection results including bounding boxes, labels, and proctoring analysis
    """
    global proctoring_model, proctoring_processor, proctoring_model_loaded
    
    # Ensure model is loaded
    if not proctoring_model_loaded:
        load_success = load_proctoring_model()
        if not load_success:
            return {
                "success": False,
                "error": "Proctoring model not loaded",
                "detections": [],
                "proctoring": {
                    "gadgets_visible": [],
                    "other_persons_present": False,
                    "other_persons_count": 0,
                    "unusual_items": [],
                    "red_flags": [],
                    "notes": "Model loading failed"
                }
            }
    
    try:
        # Decode base64 image
        image_bytes = base64.b64decode(image_base64)
        image = Image.open(BytesIO(image_bytes)).convert("RGB")
        
        # Get image dimensions
        width, height = image.size
        
        # Preprocess the image
        inputs = proctoring_processor(images=image, return_tensors="pt")
        
        # Perform object detection (no gradients needed for inference)
        with torch.no_grad():
            outputs = proctoring_model(**inputs)
        
        # Post-process the outputs to get bounding boxes and labels
        target_sizes = torch.tensor([image.size[::-1]])  # (height, width)
        results = proctoring_processor.post_process_object_detection(
            outputs, 
            target_sizes=target_sizes, 
            threshold=confidence_threshold
        )[0]
        
        # Extract detections
        detections = []
        person_count = 0
        gadgets_visible = []
        unusual_items = []
        red_flags = []
        
        logger.info("=" * 100)
        logger.info("🔍 OBJECT DETECTION RESULTS - DETAILED LOG")
        logger.info("=" * 100)
        
        for score, label, box in zip(results["scores"], results["labels"], results["boxes"]):
            # Get label name
            label_id = label.item()
            label_name = proctoring_model.config.id2label[label_id]
            confidence = round(score.item(), 3)
            
            # Get bounding box coordinates [x_min, y_min, x_max, y_max]
            box_coords = [round(i, 2) for i in box.tolist()]
            
            detection = {
                "label": label_name,
                "confidence": confidence,
                "bounding_box": {
                    "x_min": box_coords[0],
                    "y_min": box_coords[1],
                    "x_max": box_coords[2],
                    "y_max": box_coords[3]
                }
            }
            detections.append(detection)
            
            # LOG EACH DETECTION IN DETAIL
            logger.info(f"")
            logger.info(f"   🎯 Object #{len(detections)}: {label_name.upper()}")
            logger.info(f"      Confidence: {confidence * 100:.1f}%")
            logger.info(f"      Bounding Box: x=[{box_coords[0]}, {box_coords[2]}], y=[{box_coords[1]}, {box_coords[3]}]")
            logger.info(f"      Size: {box_coords[2] - box_coords[0]:.1f} x {box_coords[3] - box_coords[1]:.1f} pixels")
            
            # Proctoring analysis
            if label_name == "person":
                person_count += 1
                logger.info(f"      ✅ Person detected (count: {person_count})")
            elif label_name == "cell phone":
                gadgets_visible.append("cell phone")
                red_flags.append(f"Cell phone detected with {confidence} confidence at {box_coords}")
                logger.info(f"      🚨 RED FLAG: Cell phone detected!")
            elif label_name == "laptop":
                gadgets_visible.append("laptop")
                logger.info(f"      ⚠️  Laptop detected (may be authorized)")
            elif label_name == "tv":
                gadgets_visible.append("tv/monitor")
                logger.info(f"      ⚠️  TV/Monitor detected")
            elif label_name == "book":
                unusual_items.append("book")
                logger.info(f"      📚 Book detected (unauthorized material?)")
            
        logger.info("")
        logger.info("=" * 100)
        
        # Check for multiple persons (red flag)
        other_persons_present = person_count > 1
        if person_count > 1:
            red_flags.append(f"Multiple persons detected: {person_count} people in frame")
            logger.info(f"")
            logger.info(f"   🚨🚨 CRITICAL RED FLAG: Multiple persons detected ({person_count} people)!")
        
        # Build proctoring result
        proctoring_result = {
            "gadgets_visible": list(set(gadgets_visible)),  # Remove duplicates
            "other_persons_present": other_persons_present,
            "other_persons_count": max(0, person_count - 1) if person_count > 0 else 0,
            "unusual_items": unusual_items,
            "red_flags": red_flags,
            "notes": f"Detected {len(detections)} objects total, {person_count} person(s) in frame"
        }
        
        logger.info("")
        logger.info("📊 PROCTORING SUMMARY:")
        logger.info("=" * 100)
        logger.info(f"   Total Objects Detected: {len(detections)}")
        logger.info(f"   Persons in Frame: {person_count}")
        logger.info(f"   Gadgets Visible: {gadgets_visible if gadgets_visible else 'None'}")
        logger.info(f"   Unusual Items: {unusual_items if unusual_items else 'None'}")
        logger.info(f"   Red Flags: {len(red_flags)}")
        if red_flags:
            for i, flag in enumerate(red_flags, 1):
                logger.info(f"      {i}. {flag}")
        logger.info("=" * 100)
        logger.info("")
        
        # LOG THE COMPLETE JSON OUTPUT
        logger.info("📤 JSON RESPONSE BEING RETURNED:")
        logger.info("=" * 100)
        result_json = {
            "success": True,
            "detections": detections,
            "detection_count": len(detections),
            "image_dimensions": {"width": width, "height": height},
            "proctoring": proctoring_result
        }
        logger.info(json.dumps(result_json, indent=2))
        logger.info("=" * 100)
        logger.info("")
        
        return result_json
        
    except Exception as e:
        logger.error(f"❌ Object detection failed: {e}")
        logger.error(traceback.format_exc())
        return {
            "success": False,
            "error": str(e),
            "detections": [],
            "proctoring": {
                "gadgets_visible": [],
                "other_persons_present": False,
                "other_persons_count": 0,
                "unusual_items": [],
                "red_flags": [],
                "notes": f"Detection failed: {str(e)}"
            }
        }

def load_candidate_data(session_id: str = None):
    """Load candidate data from KMS directory"""
    global current_candidate_data
    try:
        if session_id:
            file_path = f"KMS/candidate_{session_id}.json"
            if os.path.exists(file_path):
                with open(file_path, "r") as f:
                    current_candidate_data = json.load(f)
                    return current_candidate_data
        
        # If no session_id or file not found, try to get the latest file
        kms_dir = "KMS"
        if os.path.exists(kms_dir):
            files = [f for f in os.listdir(kms_dir) if f.startswith("candidate_") and f.endswith(".json")]
            if files:
                # Get the most recent file
                latest_file = max(files, key=lambda f: os.path.getmtime(os.path.join(kms_dir, f)))
                with open(os.path.join(kms_dir, latest_file), "r") as f:
                    current_candidate_data = json.load(f)
                    return current_candidate_data
    except Exception as e:
        print(f"Error loading candidate data: {e}")
    return None

class MockInterviewer(Agent):
    """
    SkillCef: An AI mock interviewer designed to conduct realistic interview sessions.
    Helps candidates practice their interview skills with personalized questions and constructive feedback.
    """
    def __init__(self, candidate_data=None) -> None:
        self.session_id = None
        self.last_code_review_ts: Optional[int] = None
        self.current_phase: str = "introduction"  # Track current interview phase
        self.phase_start_time: Optional[float] = None  # Track when current phase started
        self.room: Optional[rtc.Room] = None  # Store room reference for recording
        self.recording_manager = None  # Will be initialized when session starts
        # Build personalized instructions based on candidate data
        personalized_intro = ""
        if candidate_data:
            name = candidate_data.get("fullName", "")
            position = candidate_data.get("position", "").replace("-", " ").title()
            experience = candidate_data.get("experience", "").replace("-", " ").title()
            
            personalized_intro = f"""
                    CANDIDATE INFORMATION (Use this to personalize the interview):
                    - Name: {name}
                    - Position: {position}
                    - Experience Level: {experience}
                    
                    Use this information to:
                    - Address the candidate by name
                    - Tailor questions to their position ({position})
                    - Adjust difficulty based on experience level ({experience})
                    """
        
        super().__init__(
            instructions=( 
                f"""
                    You are SkillCef, an AI mock interviewer conducting a realistic interview session. Your role is to:
                    
                    {personalized_intro}
                    
                    CRITICAL: Ask ONLY ONE QUESTION AT A TIME. Wait for their complete answer before asking the next question. Do NOT list multiple questions together.
                    
                    INTERVIEW STRUCTURE (Follow this EXACT flow - ONE PHASE AT A TIME):
                    =====================================================================
                    
                    PHASE 1: INTRODUCTION (2-3 minutes)
                    - Greet the candidate warmly by name as SkillCef
                    - Introduce yourself briefly as their mock interviewer
                    - Acknowledge that you know their target position and experience level
                    - Ask them to introduce themselves and tell you about their background (ONE question)
                    - Brief discussion about their experience and interests
                    
                    PHASE 2: TECHNICAL QUESTIONS (5-7 minutes)
                    - Ask 2-3 conceptual/technical questions based on their role (ONE at a time)
                    - For Software Engineer: algorithms, data structures, system design basics
                    - For Data Scientist: ML algorithms, statistics, data processing
                    - For Product Manager: product metrics, user research, prioritization
                    - Wait for complete answers, provide brief encouraging feedback
                    
                    PHASE 3: CODING QUESTION (For technical roles only - 10-15 minutes)
                    - Give ONE small coding problem (e.g., "Write a function to reverse a string", "Find the largest number in an array", "Check if a string is a palindrome")
                    - Instruct them: "Please click the code editor button to write your solution. You can find it in the toolbar at the top - it's the third button with the coding brackets icon, right after the microphone and camera buttons. When you're done, click 'Done' in the editor."
                    - UI BUTTON LAYOUT (from left to right):
                      1st: Microphone button (mic icon)
                      2nd: Camera button (camera icon)
                      3rd: Code Editor button (coding brackets icon) ← This is the one for coding
                      4th: Chat button (chat icon)
                      5th: End call button (phone icon)
                    - Wait for them to submit their code via the editor
                    - When they submit code, you will receive it in a code block format with the language specified
                    - Analyze their code and provide feedback:
                      1. Provide CONCISE feedback (2-3 sentences max)
                      2. State if the solution is correct or has issues
                      3. Mention specific parts of their code
                      4. Suggest ONE key improvement if needed
                      5. Ask ONE follow-up question about optimization or edge cases
                      6. Then move to the next phase
                    
                    IMPORTANT - Code Analysis Format:
                    ✅ GOOD: "Great! Your solution using [::-1] for string reversal is correct and efficient - it's O(n) time complexity. One improvement: add input validation to handle None or empty strings. What's the space complexity of your approach?"
                    ❌ BAD: Long explanations with multiple paragraphs, generic feedback without referencing their actual code
                    
                    PHASE 4: HR/BEHAVIORAL QUESTIONS (5-7 minutes)
                    - Ask 2-3 behavioral questions (ONE at a time)
                    - "Tell me about a time when..." style questions
                    - Ask about teamwork, challenges, problem-solving
                    - Ask about career goals and motivations
                    - Close with asking if they have questions for you
                    
                    4. Interview Guidelines:
                    - Ask ONLY ONE QUESTION per response
                    - Wait for their complete answer before asking the next question
                    - Provide brief encouraging feedback when appropriate
                    - Ask ONE follow-up question if needed to dive deeper
                    - Maintain a professional yet friendly tone as SkillCef
                    - End with asking if they have questions for you (ONE question)
                    
                    Remember: You are SkillCef, an AI mock interviewer. Ask ONE question at a time and wait for responses. This is a practice session to help them improve their interview skills. Be encouraging but realistic, and always refer to yourself as SkillCef.
                    
                    5. Technical Discussion Guidelines:
                    - Focus on verbal explanations and discussions
                    - When user mentions projects, ask them to describe the architecture and technologies used
                    - During technical discussions, ask detailed questions about implementation
                    - Request explanations of problem-solving approaches
                    - Engage with follow-up questions based on their verbal responses
                    
                    IMPORTANT - Code Editor Workflow:
                    - When you give a coding question, tell them to click the code editor button with the coding brackets icon in the toolbar
                    - Guide them clearly: "Click the third button in the top toolbar - the one with the coding brackets icon, right after the camera button"
                    - They will write code in a full-featured editor with syntax highlighting and language selection
                    - When they click "Done", their code will be automatically sent to you in a properly formatted code block
                    - Analyze the actual code they wrote and provide specific, constructive feedback
                    - Reference specific variables, functions, and logic from their code in your feedback
                    
                    BUTTON GUIDANCE FOR USER:
                    - If a user seems confused about where to write code, guide them: "Look at the top toolbar. The third button from the left has a coding brackets icon - that's the code editor. It's right after the microphone and camera buttons."
                """
            )
        )

    async def check_status(self, session_id: str) -> dict:
        """Check actual camera and screen status via API"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "http://localhost:8000/api/check-status",
                    json={"session_id": session_id},
                    timeout=10.0
                )
                if response.status_code == 200:
                    return response.json()
                else:
                    return {"success": False, "message": "Status check failed"}
        except Exception as e:
            return {"success": False, "message": f"Error: {str(e)}"}

    # Vision and screenshot methods removed - no longer processing images with AI

    # Screen sharing and code extraction methods removed - no longer using this functionality

    # Screen sharing and code extraction logic removed from generate_reply - standard behavior now

###############################################
# FASTAPI BACKEND (merged from api_server.py) #
###############################################

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("skillcef.api")

# Tesseract OCR configuration removed - no longer using screen sharing or code extraction

# FastAPI app (runs alongside the agent)
app = FastAPI(title="SkillCef Mock Interview API (embedded)")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory stores
candidate_data_store: Dict[str, Dict[str, Any]] = {}
vision_analysis_store: Dict[str, Dict[str, Any]] = {}
proctor_store: Dict[str, Dict[str, Any]] = {}

# Recording and phase tracking stores
recording_store: Dict[str, Dict[str, Any]] = {}  # session_id -> recording metadata
phase_timestamps: Dict[str, List[Dict[str, Any]]] = {}  # session_id -> list of phase transitions
transcript_store: Dict[str, List[Dict[str, Any]]] = {}  # session_id -> timestamped transcripts

# Mount recordings directory as static files
os.makedirs("recordings", exist_ok=True)
app.mount("/recordings", StaticFiles(directory="recordings"), name="recordings")

# Ensure proctoring directory exists and mount as static
os.makedirs("proctoring", exist_ok=True)
app.mount("/proctoring", StaticFiles(directory="proctoring"), name="proctoring")


class CandidateData(BaseModel):
    fullName: str
    email: str
    phone: Optional[str] = None
    position: str
    experience: str
    resumeFileName: Optional[str] = None
    resumeFilePath: Optional[str] = None
    session_id: Optional[str] = None


class TranscriptMessage(BaseModel):
    name: str
    message: str
    timestamp: int
    isSelf: bool


class AnalysisRequest(BaseModel):
    session_id: Optional[str] = None
    transcript: List[TranscriptMessage]
    candidate: Optional[Dict[str, Any]] = None
    resume: Optional[Dict[str, Any]] = None
    role: Optional[str] = None


class AnalysisResponse(BaseModel):
    markdown: str
    summary: Dict[str, Any]
    keywords: List[str]


class VisionFrameRequest(BaseModel):
    session_id: str
    frame_data: str
    frame_type: str
    timestamp: int


class VisionAnalysisResponse(BaseModel):
    success: bool
    analysis: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


class ProctorFaceUpload(BaseModel):
    session_id: str
    face_frame: str  # base64 jpeg/png without data prefix


@app.post("/api/proctor/upload-candidate-face")
async def upload_candidate_face(req: ProctorFaceUpload):
    try:
        # Prepare directory
        session_dir = os.path.join("proctoring", req.session_id)
        os.makedirs(session_dir, exist_ok=True)

        # Decode image
        try:
            img_bytes = base64.b64decode(req.face_frame)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid base64 image data")

        # Save as JPEG
        file_path = os.path.join(session_dir, "candidate.jpg")
        with open(file_path, "wb") as f:
            f.write(img_bytes)

        # Persist reference
        proctor_store[req.session_id] = proctor_store.get(req.session_id, {})
        proctor_store[req.session_id]["candidate_face_url"] = f"/proctoring/{req.session_id}/candidate.jpg"

        logger.info(f"🟢 PROCTORING FACE SAVED: session={req.session_id} path={file_path}")
        return {"success": True, "url": proctor_store[req.session_id]["candidate_face_url"], "message": "Candidate snapshot saved"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload candidate face failed: {e}\n{traceback.format_exc()}")
        return {"success": False, "message": str(e)}


class ProctorCodeUpload(BaseModel):
    session_id: str
    screen_frame: str  # base64 jpeg/png without data prefix


@app.post("/api/proctor/upload-code-snapshot")
async def upload_code_snapshot(req: ProctorCodeUpload):
    try:
        session_dir = os.path.join("proctoring", req.session_id)
        os.makedirs(session_dir, exist_ok=True)

        try:
            img_bytes = base64.b64decode(req.screen_frame)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid base64 image data")

        file_path = os.path.join(session_dir, "code_done.jpg")
        with open(file_path, "wb") as f:
            f.write(img_bytes)

        proctor_store[req.session_id] = proctor_store.get(req.session_id, {})
        proctor_store[req.session_id]["code_snapshot_url"] = f"/proctoring/{req.session_id}/code_done.jpg"

        logger.info(f"🟢 PROCTORING CODE SAVED: session={req.session_id} path={file_path}")
        return {"success": True, "url": proctor_store[req.session_id]["code_snapshot_url"], "message": "Code snapshot saved"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload code snapshot failed: {e}\n{traceback.format_exc()}")
        return {"success": False, "message": str(e)}


@app.post("/api/candidate-data")
async def receive_candidate_data(data: CandidateData):
    try:
        logger.info("=== CANDIDATE DATA RECEIVED ===")
        session_id = data.session_id or f"session_{datetime.now().timestamp()}"
        info = {
            "fullName": data.fullName,
            "email": data.email,
            "phone": data.phone,
            "position": data.position,
            "experience": data.experience,
            "resumeFileName": data.resumeFileName,
            "resumeFilePath": data.resumeFilePath,
            "timestamp": datetime.now().isoformat(),
            "session_id": session_id,
        }
        candidate_data_store[session_id] = info
        os.makedirs("KMS", exist_ok=True)
        with open(f"KMS/candidate_{session_id}.json", "w", encoding="utf-8") as f:
            json.dump(info, f, indent=2)
        return {"success": True, "message": "Candidate data received successfully", "session_id": session_id, "data": info}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/candidate-data/{session_id}")
async def get_candidate_data(session_id: str):
    if session_id in candidate_data_store:
        return {"success": True, "data": candidate_data_store[session_id]}
    try:
        with open(f"KMS/candidate_{session_id}.json", "r", encoding="utf-8") as f:
            data = json.load(f)
            candidate_data_store[session_id] = data
            return {"success": True, "data": data}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Candidate data not found")


@app.post("/api/analyze", response_model=AnalysisResponse)
async def analyze_interview(req: AnalysisRequest):
    """Analyze the full transcript and resume to produce markdown feedback and a JSON summary."""
    try:
        # Step 1: Log incoming request data
        logger.info("=== STEP 1: ANALYSIS REQUEST RECEIVED ===")
        logger.info(f"Session ID: {req.session_id}")
        logger.info(f"Role: {req.role}")
        logger.info(f"Transcript messages count: {len(req.transcript) if req.transcript else 0}")
        logger.info(f"Candidate data provided: {'Yes' if req.candidate else 'No'}")
        logger.info(f"Resume data provided: {'Yes' if req.resume else 'No'}")
        
        # Validate transcript is not empty
        transcript_len = len(req.transcript) if isinstance(req.transcript, list) else 0
        if transcript_len == 0:
            logger.error("❌ EMPTY TRANSCRIPT: Cannot analyze interview with zero messages")
            raise HTTPException(
                status_code=400, 
                detail="Cannot analyze interview: No transcript data provided. The interview must have at least one message to generate a report."
            )
        
        # Load candidate data if not provided
        candidate = req.candidate
        if not candidate and req.session_id:
            logger.info(f"Loading candidate data from session: {req.session_id}")
            candidate = candidate_data_store.get(req.session_id)
            if not candidate:
                try:
                    with open(f"KMS/candidate_{req.session_id}.json", "r", encoding="utf-8") as f:
                        candidate = json.load(f)
                        logger.info("Candidate data loaded from file successfully")
                except FileNotFoundError:
                    logger.warning("No candidate data file found")
                    candidate = None
        
        # Step 2: Log processed data summary
        logger.info("=== STEP 2: DATA PROCESSING SUMMARY ===")
        if candidate:
            logger.info(f"Candidate: {candidate.get('fullName', 'Unknown')} - {candidate.get('position', 'Unknown')} - {candidate.get('experience', 'Unknown')}")
        else:
            logger.warning("No candidate data available for analysis")
        
        if req.transcript:
            sample_messages = req.transcript[:3] if len(req.transcript) >= 3 else req.transcript
            logger.info(f"Transcript sample (first {len(sample_messages)} messages):")
            for i, msg in enumerate(sample_messages):
                logger.info(f"  {i+1}. {msg.name}: {msg.message[:50]}{'...' if len(msg.message) > 50 else ''}")
        else:
            logger.warning("No transcript data provided")

        # Prepare model input
        try:
            os.makedirs("KMS/logs", exist_ok=True)
            # Convert transcript sample to serializable format
            transcript_sample = []
            if isinstance(req.transcript, list) and len(req.transcript) > 0:
                for item in req.transcript[:5]:
                    transcript_sample.append({
                        "name": str(item.name),
                        "message": str(item.message),
                        "timestamp": int(item.timestamp),
                        "isSelf": bool(item.isSelf),
                    })
            
            log_payload = {
                "ts": datetime.now().isoformat(),
                "session_id": req.session_id,
                "role": req.role,
                "candidate": candidate,
                "resume": req.resume,
                "transcript_count": transcript_len,
                "transcript_sample": transcript_sample,
            }
            with open(f"KMS/logs/analysis_{int(datetime.now().timestamp())}.json", "w", encoding="utf-8") as f:
                json.dump(log_payload, f, ensure_ascii=False, indent=2)
            logger.info("/api/analyze payload saved: session_id=%s role=%s transcripts=%d", req.session_id, req.role, transcript_len)
        except Exception as le:
            logger.warning("Failed saving analysis payload log: %s", le)

        # Validate OpenAI API key
        if not os.getenv("OPENAI_API_KEY"):
            logger.error("OPENAI_API_KEY is not set in environment")
            raise HTTPException(status_code=500, detail="Server misconfiguration: OPENAI_API_KEY missing")

        # Step 3: Log data preparation for OpenAI
        logger.info("=== STEP 3: PREPARING DATA FOR OPENAI ===")
        
        # Sanitize transcript to avoid non-serializable content and reduce size if huge
        sanitized_transcript = []
        if isinstance(req.transcript, list):
            original_count = len(req.transcript)
            for item in req.transcript:
                try:
                    sanitized_transcript.append({
                        "name": str(item.name),
                        "message": str(item.message),
                        "timestamp": int(item.timestamp),
                        "isSelf": bool(item.isSelf),
                    })
                except Exception as e:
                    logger.warning(f"Skipping invalid transcript item: {e}")
                    continue
            
            # Hard cap to first 500 messages to avoid token limits
            if len(sanitized_transcript) > 500:
                logger.warning(f"Transcript too long ({len(sanitized_transcript)} messages), truncating to 500")
                sanitized_transcript = sanitized_transcript[:500]
            
            logger.info(f"Processed transcript: {original_count} → {len(sanitized_transcript)} messages")
        else:
            logger.warning("No valid transcript data to process")
            sanitized_transcript = []
        
        # Validate we still have transcript after sanitization
        if len(sanitized_transcript) == 0:
            logger.error("❌ NO VALID TRANSCRIPT: All transcript messages were invalid or empty")
            raise HTTPException(
                status_code=400,
                detail="Cannot analyze interview: No valid transcript messages found after processing."
            )
        
        # Log the data being sent to OpenAI
        logger.info(f"Sending to OpenAI:")
        logger.info(f"  - Candidate: {candidate.get('fullName', 'None') if candidate else 'None'}")
        logger.info(f"  - Role: {req.role}")
        logger.info(f"  - Resume: {'Yes' if req.resume else 'No'}")
        logger.info(f"  - Transcript messages: {len(sanitized_transcript)}")
        
        if sanitized_transcript:
            total_chars = sum(len(msg['message']) for msg in sanitized_transcript)
            logger.info(f"  - Total transcript characters: {total_chars}")
            logger.info(f"  - Average message length: {total_chars // len(sanitized_transcript) if sanitized_transcript else 0}")
        
        logger.info("OpenAI request payload prepared successfully")

        messages = [
            {
                "role": "system",
                "content": (
                    "You are SkillCef, an expert interview coach. Analyze the full interview transcript and the candidate's resume. "
                    "Return a JSON response with two main sections: 'markdown' (a polished report) and 'summary' (structured data with scores). "
                    "Focus on actionable feedback, specific examples from the transcript, and concrete resume improvements. "
                    "Do not invent fake facts. Use only the given transcript and resume data. "
                    "If the transcript is empty or very short, indicate that insufficient data was provided for a proper evaluation."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "candidate": candidate,
                        "role": req.role,
                        "resume": req.resume,
                        "transcript": sanitized_transcript,
                        "instructions": {
                            "format": "Return a JSON object with 'markdown' and 'summary' fields",
                            "markdown": "A comprehensive, well-structured report with sections: Executive Summary, Technical Performance, Communication Skills, Resume Analysis, Key Strengths, Areas for Improvement, Specific Recommendations",
                            "summary": {
                                "overallScore": "0-100 integer based on actual transcript content",
                                "technicalScore": "0-100 integer based on actual transcript content", 
                                "communicationScore": "0-100 integer based on actual transcript content",
                                "resumeScore": "0-100 integer based on actual transcript content",
                                "strengths": ["list of 3-5 specific strengths from actual transcript"],
                                "areasToImprove": ["list of 3-5 specific areas from actual transcript"],
                                "recommendations": ["list of 5-7 actionable recommendations based on actual transcript"],
                                "keywords": ["list of relevant technical keywords actually mentioned in transcript"],
                                "interviewDuration": "estimated duration in minutes based on transcript timestamps",
                                "responseQuality": "brief assessment of answer quality based on actual responses"
                            },
                        },
                    },
                    ensure_ascii=False,
                ),
            },
        ]

        # Step 4: Call OpenAI and process response
        logger.info("=== STEP 4: CALLING OPENAI API ===")
        
        try:
            logger.info("Sending request to OpenAI GPT-4o-mini...")
            client = OpenAIHTTP()
            completion = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                temperature=0.2,
                response_format={"type": "json_object"}
            )
            
            logger.info("OpenAI API call successful!")
            logger.info(f"Response usage: {completion.usage.total_tokens if completion.usage else 'Unknown'} tokens")
            
        except Exception as oe:
            logger.error("OpenAI call failed: %s\n%s", oe, traceback.format_exc())
            raise HTTPException(status_code=502, detail=f"LLM call failed: {oe}")

        content = completion.choices[0].message.content or "{}"
        logger.info(f"OpenAI response length: {len(content)} characters")
        
        # Parse the JSON response
        logger.info("=== STEP 5: PROCESSING OPENAI RESPONSE ===")
        try:
            response_data = json.loads(content)
            markdown = response_data.get("markdown", "Analysis could not be generated.")
            summary = response_data.get("summary", {})
            keywords = summary.get("keywords", [])
            
            logger.info("Successfully parsed OpenAI JSON response")
            logger.info(f"Analysis sections found:")
            logger.info(f"  - Markdown report: {'Yes' if markdown else 'No'} ({len(markdown)} chars)")
            logger.info(f"  - Summary data: {'Yes' if summary else 'No'}")
            if summary:
                logger.info(f"  - Overall score: {summary.get('overallScore', 'N/A')}")
                logger.info(f"  - Technical score: {summary.get('technicalScore', 'N/A')}")
                logger.info(f"  - Communication score: {summary.get('communicationScore', 'N/A')}")
                logger.info(f"  - Resume score: {summary.get('resumeScore', 'N/A')}")
                logger.info(f"  - Strengths: {len(summary.get('strengths', []))}")
                logger.info(f"  - Improvements: {len(summary.get('areasToImprove', []))}")
                logger.info(f"  - Recommendations: {len(summary.get('recommendations', []))}")
                logger.info(f"  - Keywords: {len(keywords)}")
            
        except json.JSONDecodeError as je:
            logger.error("Failed to parse OpenAI JSON response: %s", je)
            logger.error(f"Raw response content: {content[:500]}...")
            
            # Fallback response
            markdown = "# Interview Analysis\n\nAnalysis could not be generated due to a parsing error."
            summary = {
                "overallScore": 0,
                "technicalScore": 0,
                "communicationScore": 0,
                "resumeScore": 0,
                "strengths": [],
                "areasToImprove": [],
                "recommendations": [],
                "keywords": [],
                "interviewDuration": "Unknown",
                "responseQuality": "Could not assess"
            }
            keywords = []
            logger.info("Using fallback response due to parsing error")

        logger.info("=== ANALYSIS COMPLETED SUCCESSFULLY ===")
        logger.info(f"Returning analysis response to client")
        
        return AnalysisResponse(markdown=markdown, summary=summary, keywords=keywords)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("/api/analyze failed: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@app.post("/api/vision-analyze", response_model=VisionAnalysisResponse)
async def analyze_vision_frame(req: VisionFrameRequest):
    """
    Vision analysis endpoint - NOW USING FREE LOCAL HUGGING FACE MODEL!
    No OpenAI API costs - runs completely locally
    Detects: persons, cell phones, laptops, and other COCO objects
    Returns bounding boxes for all detections
    """
    try:
        logger.info("=" * 80)
        logger.info(f"🎥 PROCTORING ANALYSIS - FREE LOCAL MODEL")
        logger.info(f"Type: {req.frame_type.upper()} | Session: {req.session_id}")
        logger.info("=" * 80)
        
        # Perform object detection using local model (lowered threshold for better detection)
        detection_result = detect_objects_in_image(req.frame_data, confidence_threshold=0.5)
        
        if not detection_result.get("success"):
            logger.error(f"❌ Detection failed: {detection_result.get('error')}")
            # Store failure but don't crash
            analysis_data = {
                "note": "Detection failed",
                "error": detection_result.get("error"),
                "type": req.frame_type,
                "proctoring": detection_result.get("proctoring", {})
            }
        else:
            # Build comprehensive analysis from detection results
            detections = detection_result.get("detections", [])
            proctoring = detection_result.get("proctoring", {})
            
            logger.info(f"✅ Detected {len(detections)} objects")
            logger.info(f"🚨 Red flags: {len(proctoring.get('red_flags', []))}")
            
            # Save annotated image if there are any detections
            annotated_image_url = None
            if len(detections) > 0:
                try:
                    # Decode image again for annotation
                    img_bytes = base64.b64decode(req.frame_data)
                    original_image = Image.open(BytesIO(img_bytes)).convert("RGB")
                    
                    # Draw bounding boxes
                    annotated_image = draw_bounding_boxes_on_image(original_image, detections)
                    
                    # Save the annotated image
                    annotated_image_url = save_annotated_image(
                        annotated_image,
                        req.session_id,
                        req.frame_type,
                        detections
                    )
                    
                    logger.info(f"🖼️  Annotated image saved: {annotated_image_url}")
                except Exception as e:
                    logger.error(f"Failed to create annotated image: {e}")
            
            # For face frames, include behavioral analysis
            if req.frame_type == "face":
                # Count persons in frame
                person_count = sum(1 for d in detections if d["label"] == "person")
                
                analysis_data = {
                    "type": "face",
                    "detections": detections,
                    "detection_count": len(detections),
                    "proctoring": proctoring,
                    "annotated_image_url": annotated_image_url,  # Save URL to annotated image
                    # Basic engagement metrics (since we have face frame)
                    "engagement_level": 8 if person_count == 1 else (3 if person_count > 1 else 0),
                    "confidence_level": 7 if person_count == 1 else 3,
                    "eye_contact_quality": "Good" if person_count == 1 else "Unclear",
                    "facial_expression": "Neutral",
                    "overall_demeanor": "Professional" if person_count == 1 else "Concerning",
                    "body_language_notes": f"{person_count} person(s) detected in frame"
                }
            else:
                # For screen frames
                analysis_data = {
                    "type": "screen",
                    "detections": detections,
                    "detection_count": len(detections),
                    "proctoring": proctoring,
                    "annotated_image_url": annotated_image_url,  # Save URL to annotated image
                    "what_is_being_shown": f"Screen with {len(detections)} objects detected",
                }
        
        # Store the analysis with full detection data
        if req.session_id not in vision_analysis_store:
            vision_analysis_store[req.session_id] = {"face_analyses": [], "screen_analyses": []}
        
        entry = {
            "timestamp": req.timestamp,
            "analysis": analysis_data
        }
        
        if req.frame_type == "face":
            vision_analysis_store[req.session_id]["face_analyses"].append(entry)
        else:
            vision_analysis_store[req.session_id]["screen_analyses"].append(entry)
        
        logger.info(f"💾 Analysis stored for session {req.session_id}")
        
        # LOG WHAT'S BEING SENT TO FRONTEND
        logger.info("")
        logger.info("📤 SENDING RESPONSE TO FRONTEND:")
        logger.info("=" * 80)
        response_preview = {
            "success": True,
            "analysis_type": analysis_data.get("type"),
            "detections_count": len(analysis_data.get("detections", [])),
            "proctoring_red_flags": len(analysis_data.get("proctoring", {}).get("red_flags", []))
        }
        logger.info(json.dumps(response_preview, indent=2))
        
        if analysis_data.get("proctoring"):
            logger.info("")
            logger.info("🔍 Proctoring Data Being Sent:")
            logger.info(json.dumps(analysis_data.get("proctoring"), indent=2))
        
        logger.info("=" * 80)
        logger.info("")

        return VisionAnalysisResponse(
            success=True, 
            analysis=analysis_data, 
            message=f"Frame analyzed with local model - {len(detections) if detection_result.get('success') else 0} objects detected"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Vision analysis failed: {e}\n{traceback.format_exc()}")
        return VisionAnalysisResponse(success=False, message=str(e))


@app.get("/api/vision-analysis/{session_id}")
async def get_vision_analysis(session_id: str):
    """Get all vision analysis data for a session - called by results page"""
    logger.info("=" * 80)
    logger.info(f"📊 FETCHING VISION ANALYSIS DATA FOR SESSION: {session_id}")
    logger.info("=" * 80)
    
    data = vision_analysis_store.get(session_id) or {"face_analyses": [], "screen_analyses": []}
    
    face_count = len(data.get("face_analyses", []))
    screen_count = len(data.get("screen_analyses", []))
    code_count = len(data.get("code_submissions", []))
    
    logger.info(f"   Face Analyses: {face_count}")
    logger.info(f"   Screen Analyses: {screen_count}")
    logger.info(f"   Code Submissions: {code_count}")
    
    # Count total red flags across all analyses
    total_red_flags = 0
    for face in data.get("face_analyses", []):
        analysis = face.get("analysis", {})
        if isinstance(analysis, dict) and analysis.get("proctoring"):
            total_red_flags += len(analysis["proctoring"].get("red_flags", []))
    
    for screen in data.get("screen_analyses", []):
        analysis = screen.get("analysis", {})
        if isinstance(analysis, dict) and analysis.get("proctoring"):
            total_red_flags += len(analysis["proctoring"].get("red_flags", []))
    
    logger.info(f"   Total Red Flags: {total_red_flags}")
    
    # Show latest proctoring data if available
    if face_count > 0:
        latest_face = data["face_analyses"][-1]
        logger.info("")
        logger.info("   Latest Face Analysis:")
        if latest_face.get("analysis", {}).get("proctoring"):
            logger.info(json.dumps(latest_face["analysis"]["proctoring"], indent=6))
    
    logger.info("=" * 80)
    logger.info("")
    
    return {"success": True, "data": data}


class ImmediateCodeAnalysisRequest(BaseModel):
    session_id: str
    face_frame: Optional[str] = None
    screen_frame: str
    problem_description: Optional[str] = None


class ImmediateCodeAnalysisResponse(BaseModel):
    success: bool
    analysis: Optional[Dict[str, Any]] = None
    feedback: Optional[str] = None
    message: Optional[str] = None


@app.post("/api/analyze-code-immediate", response_model=ImmediateCodeAnalysisResponse)
async def analyze_code_immediate(req: ImmediateCodeAnalysisRequest):
    """
    Immediate code analysis endpoint - NOW USING FREE LOCAL MODEL FOR PROCTORING!
    No OpenAI API costs - only checks for cheating/unauthorized materials
    Does NOT analyze code quality - only proctoring violations
    """
    try:
        logger.info("=" * 80)
        logger.info(f"📝 CODE SUBMISSION PROCTORING - FREE LOCAL MODEL")
        logger.info(f"Session: {req.session_id}")
        logger.info("=" * 80)
        
        # Analyze screen for proctoring violations (lowered threshold for better gadget detection)
        screen_detection = detect_objects_in_image(req.screen_frame, confidence_threshold=0.5)
        
        # Analyze face if provided (for person detection)
        face_detection = None
        if req.face_frame:
            face_detection = detect_objects_in_image(req.face_frame, confidence_threshold=0.5)
        
        # Combine proctoring results
        all_red_flags = []
        all_gadgets = []
        person_count = 0
        
        if screen_detection.get("success"):
            screen_proctoring = screen_detection.get("proctoring", {})
            all_red_flags.extend(screen_proctoring.get("red_flags", []))
            all_gadgets.extend(screen_proctoring.get("gadgets_visible", []))
        
        if face_detection and face_detection.get("success"):
            face_proctoring = face_detection.get("proctoring", {})
            all_red_flags.extend(face_proctoring.get("red_flags", []))
            all_gadgets.extend(face_proctoring.get("gadgets_visible", []))
            person_count = face_proctoring.get("other_persons_count", 0) + (1 if face_proctoring.get("other_persons_present") else 0)
        
        # Remove duplicates
        all_gadgets = list(set(all_gadgets))
        
        # Build proctoring analysis
        proctoring = {
            "gadgets_visible": all_gadgets,
            "other_persons_present": person_count > 1,
            "other_persons_count": max(0, person_count - 1),
            "unusual_items": [],
            "red_flags": all_red_flags,
            "notes": f"Proctoring check: {len(all_red_flags)} red flag(s) detected"
        }
        
        # Create analysis response
        analysis = {
            "note": "Code NOT analyzed by AI (saves costs) - only proctoring violations checked",
            "correctness": "Not analyzed",
            "proctoring": proctoring,
            "screen_detections": screen_detection.get("detections", []) if screen_detection.get("success") else [],
            "face_detections": face_detection.get("detections", []) if face_detection and face_detection.get("success") else []
        }
        
        # Generate feedback based on proctoring
        if len(all_red_flags) > 0:
            feedback = f"⚠️ PROCTORING ALERT: {len(all_red_flags)} violation(s) detected. Please discuss your solution verbally with the interviewer."
            logger.warning(f"🚨 PROCTORING VIOLATIONS: {all_red_flags}")
        else:
            feedback = "✅ No proctoring violations detected. Please discuss your solution verbally with the interviewer."
            logger.info("✅ No proctoring violations")

        # Store analysis data
        if req.session_id not in vision_analysis_store:
            vision_analysis_store[req.session_id] = {"face_analyses": [], "screen_analyses": [], "code_submissions": []}
        vision_analysis_store[req.session_id].setdefault("code_submissions", []).append({
            "timestamp": int(datetime.now().timestamp() * 1000),
            "analysis": analysis,
            "problem": req.problem_description,
        })
        
        logger.info(f"💾 Proctoring data stored for session {req.session_id}")
        logger.info("=" * 80)

        return ImmediateCodeAnalysisResponse(
            success=True, 
            analysis=analysis, 
            feedback=feedback, 
            message=f"Proctoring complete - {len(all_red_flags)} violation(s) detected"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Code proctoring failed: {e}\n{traceback.format_exc()}")
        return ImmediateCodeAnalysisResponse(success=False, message=str(e))


class StatusCheckRequest(BaseModel):
    session_id: str


class StatusCheckResponse(BaseModel):
    success: bool
    camera_active: Optional[bool] = None
    screen_active: Optional[bool] = None
    screen_content: Optional[str] = None
    message: Optional[str] = None


@app.post("/api/check-status")
async def check_interview_status(req: StatusCheckRequest):
    try:
        data = vision_analysis_store.get(req.session_id, {"face_analyses": [], "screen_analyses": []})
        face = data.get("face_analyses", [])
        screen = data.get("screen_analyses", [])
        camera_active = len(face) > 0
        screen_active = len(screen) > 0
        screen_content = None
        if screen:
            latest = screen[-1].get("analysis", {})
            screen_content = latest.get("extracted_code") or latest.get("what_is_being_shown")
        return StatusCheckResponse(success=True, camera_active=camera_active, screen_active=screen_active, screen_content=screen_content, message="Status checked successfully")
    except Exception as e:
        return StatusCheckResponse(success=False, message=str(e))


@app.post("/api/analyze-screen-now")
async def analyze_screen_now(req: StatusCheckRequest):
    try:
        if not hasattr(analyze_screen_now, 'pending_requests'):
            analyze_screen_now.pending_requests = {}
        analyze_screen_now.pending_requests[req.session_id] = {"timestamp": datetime.now().timestamp(), "status": "pending"}
        return {"success": True, "message": "Fresh screenshot requested - frontend will capture shortly", "request_id": req.session_id, "timestamp": datetime.now().timestamp()}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/screenshot-requests/{session_id}")
async def get_screenshot_requests(session_id: str):
    try:
        if not hasattr(analyze_screen_now, 'pending_requests'):
            analyze_screen_now.pending_requests = {}
        req = analyze_screen_now.pending_requests.get(session_id)
        if req and req["status"] == "pending":
            analyze_screen_now.pending_requests[session_id]["status"] = "processing"
            return {"has_request": True, "timestamp": req["timestamp"], "message": "Fresh screenshot needed"}
        return {"has_request": False, "message": "No pending screenshot requests"}
    except Exception as e:
        return {"has_request": False, "message": str(e)}


# ==============================================================================
# RECORDING AND SEGMENTATION API ENDPOINTS
# ==============================================================================

class PhaseTransitionRequest(BaseModel):
    session_id: str
    new_phase: str
    reason: Optional[str] = None


class TranscriptEntry(BaseModel):
    session_id: str
    name: str
    message: str
    timestamp: int
    is_self: bool


@app.post("/api/recording/start")
async def start_recording(session_id: str, room_name: str):
    """Start recording for a session"""
    try:
        logger.info("=" * 80)
        logger.info("🎥 RECORDING START REQUEST")
        logger.info("=" * 80)
        logger.info(f"   Session ID: {session_id}")
        logger.info(f"   Room Name: {room_name}")
        
        recording_manager = get_recording_manager(session_id)
        
        # Get LiveKit credentials from environment
        livekit_url = os.getenv("LIVEKIT_URL", "")
        api_key = os.getenv("LIVEKIT_API_KEY", "")
        api_secret = os.getenv("LIVEKIT_API_SECRET", "")
        
        if not all([livekit_url, api_key, api_secret]):
            logger.warning("   ⚠️  LiveKit credentials not found - using frontend recording fallback")
            logger.info("   ✅ Recording will be handled by browser MediaRecorder API")
            logger.info("=" * 80)
            return {"success": True, "method": "frontend", "message": "Recording will be handled by frontend"}
        
        success = recording_manager.start_recording(room_name, livekit_url, api_key, api_secret)
        if success:
            recording_store[session_id] = {
                "session_id": session_id,
                "started_at": datetime.now().isoformat(),
                "method": "egress"
            }
            logger.info(f"   ✅ Recording started via LiveKit Egress (ID: {recording_manager.egress_id})")
            logger.info("=" * 80)
            return {"success": True, "method": "egress", "egress_id": recording_manager.egress_id}
        else:
            logger.info("   ✅ Recording will use frontend MediaRecorder API")
            logger.info("=" * 80)
            return {"success": True, "method": "frontend", "message": "Falling back to frontend recording"}
    except Exception as e:
        logger.error(f"   ❌ Failed to start recording: {e}")
        logger.info("=" * 80)
        return {"success": False, "error": str(e)}


@app.post("/api/recording/stop")
async def stop_recording(session_id: str):
    """Stop recording and segment video"""
    try:
        logger.info("=" * 80)
        logger.info("🛑 RECORDING STOP REQUEST")
        logger.info("=" * 80)
        logger.info(f"   Session ID: {session_id}")
        
        recording_manager = get_recording_manager(session_id)
        recording_manager.stop_recording()
        
        # Log phase summary
        phases = recording_manager.phase_tracker.get_phase_timestamps()
        logger.info(f"   📊 Total phases tracked: {len(phases) + 1}")
        logger.info(f"   📝 Current phase: {recording_manager.phase_tracker.current_phase}")
        logger.info("   ⏳ Waiting for video upload...")
        logger.info("=" * 80)
        
        # Note: Video segmentation will be triggered when video file is available
        return {"success": True, "message": "Recording stopped"}
    except Exception as e:
        logger.error(f"   ❌ Failed to stop recording: {e}")
        logger.info("=" * 80)
        return {"success": False, "error": str(e)}


@app.post("/api/recording/phase-transition")
async def record_phase_transition(req: PhaseTransitionRequest):
    """Record a phase transition"""
    try:
        recording_manager = get_recording_manager(req.session_id)
        old_phase = recording_manager.phase_tracker.current_phase
        recording_manager.phase_tracker.record_phase_transition(req.new_phase, req.reason or "")
        
        phase_timestamps[req.session_id] = recording_manager.phase_tracker.get_phase_timestamps()
        
        logger.info(f"📊 Phase transition: {old_phase} → {req.new_phase} (Session: {req.session_id})")
        if req.reason:
            logger.info(f"   Reason: {req.reason[:50]}")
        
        return {"success": True, "current_phase": req.new_phase}
    except Exception as e:
        logger.error(f"Failed to record phase transition: {e}")
        return {"success": False, "error": str(e)}


@app.post("/api/recording/transcript")
async def save_transcript_entry(entry: TranscriptEntry):
    """Save a transcript entry with timestamp"""
    try:
        if entry.session_id not in transcript_store:
            transcript_store[entry.session_id] = []
            logger.info(f"📝 Created transcript store for session: {entry.session_id}")
        
        transcript_store[entry.session_id].append({
            "name": entry.name,
            "message": entry.message,
            "timestamp": entry.timestamp,
            "is_self": entry.is_self
        })
        
        # Log transcript (but not too verbose - only every 10th message)
        transcript_count = len(transcript_store[entry.session_id])
        if transcript_count % 10 == 0 or transcript_count == 1:
            logger.info(f"📝 Transcript entries: {transcript_count} (Session: {entry.session_id})")
        
        # Try to detect phase from message
        recording_manager = get_recording_manager(entry.session_id)
        detected_phase = recording_manager.phase_tracker.detect_phase_from_message(
            entry.message, 
            not entry.is_self  # Agent messages are not from self
        )
        
        if detected_phase and detected_phase != recording_manager.phase_tracker.current_phase:
            recording_manager.phase_tracker.record_phase_transition(detected_phase, f"Detected from message: {entry.message[:50]}")
            phase_timestamps[entry.session_id] = recording_manager.phase_tracker.get_phase_timestamps()
            logger.info(f"📊 Auto-detected phase transition: {recording_manager.phase_tracker.current_phase} → {detected_phase}")
        
        return {"success": True}
    except Exception as e:
        logger.error(f"Failed to save transcript entry: {e}")
        return {"success": False, "error": str(e)}


class SegmentRequest(BaseModel):
    session_id: str
    video_path: str

@app.post("/api/recording/segment")
async def segment_video(req: SegmentRequest):
    """Segment video into phases using FFmpeg"""
    try:
        logger.info("=" * 80)
        logger.info("🔄 VIDEO SEGMENTATION REQUEST")
        logger.info("=" * 80)
        logger.info(f"   Session ID: {req.session_id}")
        logger.info(f"   Video Path: {req.video_path}")
        
        recording_manager = get_recording_manager(req.session_id)
        
        # Get transcripts for this session
        transcripts = transcript_store.get(req.session_id, [])
        logger.info(f"   📝 Transcripts available: {len(transcripts)} entries")
        
        # Segment video with transcripts for AI analysis
        segments = recording_manager.segment_video(req.video_path, transcripts=transcripts)
        
        # Save metadata
        metadata_path = recording_manager.save_metadata(segments, transcripts)
        
        logger.info(f"   ✅ Segmentation complete: {len(segments)} segments created")
        logger.info("=" * 80)
        
        return {
            "success": True,
            "segments": segments,
            "metadata_path": str(metadata_path),
            "total_segments": len(segments)
        }
    except Exception as e:
        logger.error(f"   ❌ Failed to segment video: {e}")
        logger.info("=" * 80)
        import traceback
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


@app.get("/api/recording/metadata/{session_id}")
async def get_recording_metadata(session_id: str):
    """Get recording metadata including segments and transcripts"""
    try:
        import json
        from pathlib import Path
        
        recordings_dir = Path("recordings") / session_id
        metadata_path = recordings_dir / "metadata.json"
        
        if not metadata_path.exists():
            return {"success": False, "error": "Metadata not found"}
        
        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
        
        return {"success": True, "metadata": metadata}
    except Exception as e:
        logger.error(f"Failed to get recording metadata: {e}")
        return {"success": False, "error": str(e)}


@app.get("/api/recording/phases/{session_id}")
async def get_phase_timestamps(session_id: str):
    """Get phase timestamps for a session"""
    try:
        recording_manager = get_recording_manager(session_id)
        phases = recording_manager.phase_tracker.get_phase_timestamps()
        
        return {
            "success": True,
            "current_phase": recording_manager.phase_tracker.current_phase,
            "phases": phases,
            "phase_definitions": PHASES
        }
    except Exception as e:
        logger.error(f"Failed to get phase timestamps: {e}")
        return {"success": False, "error": str(e)}


from fastapi import Request, UploadFile, File, Form

@app.post("/api/recording/upload")
async def upload_recording_file(
    request: Request,
    video: UploadFile = File(...),
    session_id: str = Form(...)
):
    """Upload recording video file and save it"""
    try:
        logger.info("=" * 80)
        logger.info("📹 VIDEO UPLOAD REQUEST")
        logger.info("=" * 80)
        logger.info(f"   Session ID: {session_id}")
        logger.info(f"   File: {video.filename}")
        
        recording_manager = get_recording_manager(session_id)
        recordings_dir = recording_manager.recordings_dir
        
        # Save uploaded file
        video_filename = f"full_recording_{session_id}.webm"
        video_path = recordings_dir / video_filename
        
        logger.info(f"   💾 Saving video to: {video_path}")
        with open(video_path, "wb") as f:
            content = await video.read()
            f.write(content)
        
        file_size_mb = len(content) / (1024 * 1024)
        logger.info(f"   ✅ Video saved: {file_size_mb:.2f} MB ({len(content)} bytes)")
        
        # Get transcript count
        transcripts = transcript_store.get(session_id, [])
        logger.info(f"   📝 Transcripts available: {len(transcripts)} entries")
        
        # Get phase transitions
        phases = recording_manager.phase_tracker.get_phase_timestamps()
        logger.info(f"   📊 Phase transitions: {len(phases)}")
        
        # Trigger segmentation with transcripts for AI analysis
        logger.info("   🔄 Starting video segmentation with FFmpeg...")
        try:
            segments = recording_manager.segment_video(str(video_path), transcripts=transcripts)
            metadata_path = recording_manager.save_metadata(segments, transcripts)
            
            logger.info(f"   ✅ Segmentation complete: {len(segments)} segments created")
            logger.info(f"   💾 Metadata saved: {metadata_path}")
            logger.info("=" * 80)
            
            return {
                "success": True,
                "video_path": str(video_path),
                "video_url": f"/recordings/{session_id}/{video_filename}",
                "segments": segments,
                "metadata_path": str(metadata_path),
                "message": "Video uploaded and segmented successfully"
            }
        except Exception as seg_error:
            logger.warning(f"   ⚠️  Segmentation failed: {seg_error}")
            logger.warning("   💡 Tip: Install FFmpeg for automatic video segmentation")
            logger.info("=" * 80)
            return {
                "success": True,
                "video_path": str(video_path),
                "video_url": f"/recordings/{session_id}/{video_filename}",
                "message": "Video uploaded (segmentation skipped - install FFmpeg for auto-segmentation)"
            }
            
    except Exception as e:
        logger.error(f"   ❌ Failed to upload recording: {e}")
        logger.info("=" * 80)
        return {"success": False, "error": str(e)}


@app.delete("/api/vision-analysis/{session_id}")
async def clear_vision_analysis(session_id: str):
    try:
        if session_id in vision_analysis_store:
            del vision_analysis_store[session_id]
            return {"success": True, "message": f"Vision analysis data cleared for session {session_id}"}
        return {"success": False, "message": f"No vision analysis data found for session {session_id}"}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/health")
async def health_check():
    return {
        "status": "healthy", 
        "service": "SkillCef Embedded API",
        "proctoring_model_loaded": proctoring_model_loaded,
        "proctoring_model": "microsoft/conditional-detr-resnet-50" if proctoring_model_loaded else "not loaded"
    }


@app.get("/api/proctoring-status")
async def proctoring_status():
    """Check if the proctoring model is loaded and ready"""
    return {
        "loaded": proctoring_model_loaded,
        "model": "microsoft/conditional-detr-resnet-50",
        "description": "FREE local object detection model - no API costs",
        "capabilities": [
            "Detect persons (multiple people)",
            "Detect cell phones",
            "Detect laptops/computers",
            "Detect books and other materials",
            "Return bounding boxes for all detections"
        ],
        "status": "ready" if proctoring_model_loaded else "not loaded"
    }


# Screen sharing and code extraction endpoints removed - no longer using this functionality


def start_api_server_in_background() -> None:
    """Start the FastAPI server in a background thread."""
    import threading
    import uvicorn
    import socket

    def _check_port(port: int) -> bool:
        """Check if a port is available."""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('0.0.0.0', port))
                return True
            except OSError:
                return False

    def _run():
        port = 8000
        # Check if port is already in use
        if not _check_port(port):
            logger.warning(f"⚠️  Port {port} is already in use. Attempting to use existing server...")
            logger.info("   If you need to restart, please stop the existing process first.")
            logger.info("   On Windows: netstat -ano | findstr :8000  then  taskkill /PID <pid> /F")
            return
        
        try:
            uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
        except Exception as e:
            logger.error(f"Failed to start API server: {e}")

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    
    # Load proctoring model in the main thread (after API server starts)
    logger.info("🔄 Loading proctoring model...")
    load_proctoring_model()

async def entrypoint(ctx: agents.JobContext):
    # Load candidate data before starting the interview
    candidate_data = load_candidate_data()
    
    try:
        session = AgentSession(
            stt=openai.STT(
                model="whisper-1",
            ),
            llm=openai.LLM(
                model="gpt-4o-mini",
                temperature=0.7,  # More dynamic responses
            ),
            tts=openai.TTS(
                model="tts-1-hd",  # Higher quality, more natural sound
                voice="nova",  # Most human-like, warm, conversational voice
                instructions="Speak in a friendly and conversational tone. Keep responses concise and natural."
            ),
            vad=silero.VAD.load(),
            # Using VAD for turn detection (no heavy dependencies required)
        )

        # Start the session with the MockInterviewer agent (with personalized data)
        # Note: In newer versions of livekit-agents, noise cancellation may be configured
        # differently or handled automatically. If RoomOptions doesn't support it directly,
        # we can omit it - the session will still work without explicit noise cancellation config.
        await session.start(
            room=ctx.room,
            agent=MockInterviewer(candidate_data=candidate_data),
            # room_options parameter removed - noise cancellation may be configured
            # at the AgentSession level or handled automatically in newer versions
        )
    except Exception as e:
        print(f"Session error: {e}")
        # Try to gracefully handle the error
        try:
            await ctx.room.disconnect()
        except:
            pass
        raise

    # Greet the user with personalized message
    if candidate_data:
        name = candidate_data.get("fullName", "")
        position = candidate_data.get("position", "").replace("-", " ").title()
        greeting = f"Greet {name} warmly as SkillCef. Mention that you'll be conducting their mock interview for the {position} position. Let them know you'll be focusing on their verbal communication and technical discussion skills. Welcome them and make them feel comfortable."
    else:
        greeting = "Greet the user as SkillCef and introduce yourself as their AI mock interviewer. Welcome them to their practice interview session and let them know you'll be conducting a conversation-based interview."
    
    await session.generate_reply(
        instructions=greeting
    )

if __name__ == "__main__":
    try:
        # Start the embedded API server
        start_api_server_in_background()

        # Run the agent app from the command line
        agents.cli.run_app(
            agents.WorkerOptions(
                entrypoint_fnc=entrypoint
            )
        )
    except Exception as e:
        print(f"Error starting agent: {str(e)}")
        # Add proper cleanup
        import sys
        sys.exit(1)
