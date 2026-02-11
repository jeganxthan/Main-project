import cv2
import numpy as np
from ultralytics import YOLO
import threading
import time
import os
from flask import Flask, jsonify, send_file, Response, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ---------------- CONFIG ----------------
RTSP_URL = "rtsp://admin:123456789@192.168.1.39:554/stream2"
FRAME_SKIP = 2
# Balanced thresholds (tuned to avoid misses while still filtering casual walking)
# Increased sensitivity for user
MOTION_AVG_THRESHOLD = 2.5
MOTION_PIXEL_THRESHOLD = 10
MOTION_RATIO_THRESHOLD = 0.003
MOTION_SPIKE_FACTOR = 1.15
MOTION_BASELINE_WINDOW = 15
VIOLENT_FRAMES_REQUIRED = 3
PERSON_CONFIDENCE = 0.2
ENHANCED_DIR = "enhanced"
VIDEO_DIR = "videos"
os.makedirs(ENHANCED_DIR, exist_ok=True)
os.makedirs(VIDEO_DIR, exist_ok=True)

# Global state
initial_result = {
    "alert": "NONE",
    "fight": False,
    "blood": False,
    "image_urls": [],
    "video_url": None,
    "frame": None,
    "timestamp": None,
    "current_motion": 0.0
}
latest_result = initial_result.copy()
current_frame = None
frame_lock = threading.Lock()
is_monitoring = True
is_recording = False

# Load models
model = YOLO("yolov8n.pt")
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

def enhance_frame_mild(frame):
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8))
    l = clahe.apply(l)
    merged = cv2.merge((l, a, b))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)

def get_face_score(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, 1.1, 4)
    return sum(w * h for (x, y, w, h) in faces) if len(faces) > 0 else 0

def record_fight(buffer_frames, timestamp, frame_size):
    global is_recording
    is_recording = True
    filename = f"fight_{timestamp}.mp4"
    path = os.path.join(VIDEO_DIR, filename)
    
    # Try avc1 (H.264) first, fallback to mp4v
    try:
        fourcc = cv2.VideoWriter_fourcc(*'avc1')
        out = cv2.VideoWriter(path, fourcc, 15.0, frame_size)
        if not out.isOpened():
            print("⚠️ avc1 codec failed, falling back to mp4v")
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            out = cv2.VideoWriter(path, fourcc, 15.0, frame_size)
    except Exception as e:
        print(f"⚠️ Error initializing VideoWriter with avc1: {e}, falling back to mp4v")
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(path, fourcc, 15.0, frame_size)
    
    print(f"📹 Starting video recording: {filename}")
    for f in buffer_frames:
        out.write(f)
        
    count = 0
    # Capture 10 seconds (Approx 150 frames at 15fps)
    while count < 150:
        with frame_lock:
            if current_frame is not None:
                out.write(current_frame)
                count += 1
        time.sleep(0.04)
        
    out.release()
    print(f"✅ Video recording finished: {path}")
    
    latest_result["video_url"] = f"/video/{filename}"
    is_recording = False

def monitor_stream():
    global latest_result, is_monitoring, current_frame, is_recording
    print(f"Connecting to RTSP: {RTSP_URL}")
    cap = cv2.VideoCapture(RTSP_URL, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    
    prev_gray = None
    violent_count = 0
    frame_i = 0
    buffer = []
    # Load models
    model = YOLO("yolov8n.pt") 
    violence_model = YOLO("yolov8violence_final.pt")
    motion_history = []

    while is_monitoring:
        try:
            ret, frame = cap.read()
            if not ret:
                cap.release()
                time.sleep(2)
                cap = cv2.VideoCapture(RTSP_URL, cv2.CAP_FFMPEG)
                continue

            with frame_lock:
                current_frame = frame.copy()

            frame_i += 1
            if frame_i % FRAME_SKIP != 0:
                continue

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            if prev_gray is None:
                prev_gray = gray
                continue

            diff = cv2.absdiff(prev_gray, gray)
            motion_avg = float(np.mean(diff))
            motion_ratio = float(np.mean(diff > MOTION_PIXEL_THRESHOLD))
            latest_result["current_motion"] = float(motion_avg)
            motion_history.append(motion_avg)
            if len(motion_history) > MOTION_BASELINE_WINDOW:
                motion_history.pop(0)
            baseline = float(np.median(motion_history)) if motion_history else motion_avg
            
            person_count = 0
            is_violence_detected = False
            violence_conf = 0.0

            # Only run heavy AI if there is SOME motion
            if motion_avg > 1.0: 
                # 1. Person Detection
                results = model(frame, conf=PERSON_CONFIDENCE, verbose=False)
                person_count = sum(1 for r in results for c in r.boxes.cls if model.names[int(c)] == "person")
                
                # 2. Violence Detection (Secondary Check)
                # Only check if people are present to avoid false alarms on moving objects
                if person_count >= 1:
                    v_results = violence_model(frame, verbose=False)
                    for box in v_results[0].boxes:
                        cls_id = int(box.cls[0])
                        conf = float(box.conf[0])
                        # Class 1 is 'Violence', Class 0 is 'NonViolence'
                        # Balanced threshold: 0.65 catches fights while filtering dancing
                        if cls_id == 1 and conf > 0.65:
                            is_violence_detected = True
                            violence_conf = conf
                            break

            # Debug: Log occasionally
            if frame_i % 100 == 0:
                print(
                    f"Live Monitor - Frame {frame_i}, Motion: {motion_avg:.2f}, "
                    f"Persons: {person_count}, Violence detected: {is_violence_detected}"
                )

            buffer.append(frame.copy())
            if len(buffer) > 50:
                buffer.pop(0)
            
            # TRIGGER LOGIC
            # Strict Rule: AI must say it is VIOLENCE.
            # This filters out "dancing" (NonViolence) or "running" (NonViolence).
            if is_violence_detected:
                 violent_count += 1
                 print(f"🔥 VIOLENCE DETECTED! Conf: {violence_conf:.2f}, Motion: {motion_avg:.2f}, Persons: {person_count}, Count: {violent_count}")
            elif person_count >= 1 and motion_avg > 5.0:
                 # Optional: Warn if high motion but NO violence detected
                 print(f"⚠️ High Motion ({motion_avg:.2f}) but classified as Non-Violence. Ignored.")
                 violent_count = max(0, violent_count - 1)
            else:
                 violent_count = max(0, violent_count - 1)

            if violent_count >= VIOLENT_FRAMES_REQUIRED:
                if not latest_result["fight"]:
                    print(f"🚨 ALERT: Fight Confirmed! Motion: {motion_avg:.2f}, Conf: {violence_conf:.2f}")
                    timestamp = int(time.time())
                    
                    scored_frames = [(get_face_score(f), f) for f in buffer]
                    scored_frames.sort(key=lambda x: x[0], reverse=True)
                    top_frames = scored_frames[:5]
                    image_urls = []
                    
                    for idx, (score, f) in enumerate(top_frames):
                        processed = enhance_frame_mild(f) if score < 1000 else f
                        img_filename = f"detection_{timestamp}_{idx}.jpg"
                        cv2.imwrite(os.path.join(ENHANCED_DIR, img_filename), processed)
                        image_urls.append(f"/image/{img_filename}")

                    latest_result.update({
                        "alert": "HIGH",
                        "fight": True,
                        "image_urls": image_urls,
                        "video_url": None,
                        "frame": frame_i,
                        "timestamp": timestamp
                    })
                    
                    h, w = frame.shape[:2]
                    threading.Thread(target=record_fight, args=(list(buffer), timestamp, (w, h)), daemon=True).start()
                    
                violent_count = 0

            prev_gray = gray
        except Exception as e:
            print(f"Monitor Loop Error: {e}")
            time.sleep(1)

    cap.release()

def generate_frames():
    while True:
        frame_to_send = None
        with frame_lock:
            if current_frame is not None:
                frame_to_send = current_frame.copy()
        if frame_to_send is None:
            time.sleep(0.1)
            continue
        ret, jpeg_buffer = cv2.imencode('.jpg', frame_to_send, [int(cv2.IMWRITE_JPEG_QUALITY), 60])
        if not ret: continue
        frame_bytes = jpeg_buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n'
               b'Content-Length: ' + str(len(frame_bytes)).encode() + b'\r\n\r\n' +
               frame_bytes + b'\r\n')
        time.sleep(0.06)

@app.route("/video_feed")
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route("/run-ai")
def run_ai():
    return jsonify(latest_result)

@app.route("/reset-alert", methods=["POST", "GET"])
def reset_alert():
    global latest_result
    print("🚓 Police Reset Alert Requested")
    latest_result = initial_result.copy()
    return jsonify({"status": "reset"})

@app.route("/image/<filename>")
def get_image(filename):
    image_path = os.path.join(ENHANCED_DIR, filename)
    if os.path.exists(image_path):
        return send_file(image_path, mimetype='image/jpeg')
    return jsonify({"error": "Image not found"}), 404

@app.route("/video/<filename>")
def get_video(filename):
    video_path = os.path.join(VIDEO_DIR, filename)
    print(f"🎬 Video request: {filename}")
    if os.path.exists(video_path):
        file_size = os.path.getsize(video_path)
        range_header = request.headers.get('Range')

        if range_header:
            # Example: "bytes=0-1023"
            bytes_unit, bytes_range = range_header.split('=', 1)
            if bytes_unit != 'bytes':
                return send_file(video_path, mimetype='video/mp4')

            start_str, end_str = bytes_range.split('-', 1)
            try:
                start = int(start_str) if start_str else 0
                end = int(end_str) if end_str else file_size - 1
            except ValueError:
                start, end = 0, file_size - 1

            end = min(end, file_size - 1)
            length = end - start + 1

            with open(video_path, 'rb') as f:
                f.seek(start)
                data = f.read(length)

            response = Response(data, status=206, mimetype='video/mp4', direct_passthrough=True)
            response.headers['Content-Range'] = f'bytes {start}-{end}/{file_size}'
            response.headers['Accept-Ranges'] = 'bytes'
            response.headers['Content-Length'] = str(length)
            return response

        # No Range header - return full file
        response = send_file(video_path, mimetype='video/mp4')
        response.headers['Accept-Ranges'] = 'bytes'
        return response
    print(f"❌ Video not found: {video_path}")
    return jsonify({"error": "Video not found"}), 404

if __name__ == "__main__":
    monitor_thread = threading.Thread(target=monitor_stream, daemon=True)
    monitor_thread.start()
    app.run(host="0.0.0.0", port=5000, threaded=True)
