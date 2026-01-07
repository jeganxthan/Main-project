import cv2
import numpy as np
from ultralytics import YOLO
import os

# ---------------- CONFIG ----------------
VIDEO_PATH = "video/blood.mp4"

FRAME_SKIP = 2
MOTION_THRESHOLD = 800_000
VIOLENT_FRAMES_REQUIRED = 3
BLOOD_PIXEL_THRESHOLD = 250

FRAME_DIR = "frames"
ENHANCED_DIR = "enhanced"

os.makedirs(FRAME_DIR, exist_ok=True)
os.makedirs(ENHANCED_DIR, exist_ok=True)

# --------------------------------------

model = YOLO("yolov8n.pt")
cap = cv2.VideoCapture(VIDEO_PATH)

prev_gray = None
violent_count = 0
fight_detected = False
blood_detected = False

frame_index = 0

print("⚡ Running FAST AI detection (HEADLESS MODE)...")

# ---------------- STRONG ENHANCEMENT ----------------
def enhance_frame_strong(frame):
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)

    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    l = clahe.apply(l)

    merged = cv2.merge((l, a, b))
    enhanced = cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)

    gamma = 0.85
    inv_gamma = 1.0 / gamma
    table = np.array([
        ((i / 255.0) ** inv_gamma) * 255 for i in range(256)
    ]).astype("uint8")

    return cv2.LUT(enhanced, table)

# ---------------- MAIN LOOP ----------------
while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    frame_index += 1

    if frame_index % FRAME_SKIP != 0:
        continue

    # Save RAW frame
    cv2.imwrite(f"{FRAME_DIR}/frame_{frame_index}.jpg", frame)

    # Enhance + save
    enhanced = enhance_frame_strong(frame)
    cv2.imwrite(f"{ENHANCED_DIR}/enhanced_{frame_index}.jpg", enhanced)

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    if prev_gray is None:
        prev_gray = gray
        continue

    # ---- MOTION ----
    motion_score = cv2.absdiff(prev_gray, gray).sum()

    # ---- PERSON DETECTION ----
    results = model(frame, conf=0.3, verbose=False)
    person_count = sum(
        1 for r in results for cls in r.boxes.cls
        if model.names[int(cls)] == "person"
    )

    print(f"frame={frame_index} | motion={int(motion_score)} | persons={person_count}")

    # ---- FIGHT LOGIC ----
    if motion_score > MOTION_THRESHOLD and person_count >= 2:
        violent_count += 1
    else:
        violent_count = 0

    if violent_count >= VIOLENT_FRAMES_REQUIRED:
        fight_detected = True
        print(f"\n🔥 FAST FIGHT CONFIRMED at frame {frame_index}")

        # ---- FAST BLOOD DETECTION ----
        hsv = cv2.cvtColor(enhanced, cv2.COLOR_BGR2HSV)

        lower1 = np.array([0, 50, 20])
        upper1 = np.array([15, 255, 220])
        lower2 = np.array([160, 50, 20])
        upper2 = np.array([180, 255, 220])

        mask = cv2.inRange(hsv, lower1, upper1)
        mask |= cv2.inRange(hsv, lower2, upper2)

        blood_pixels = cv2.countNonZero(mask)
        print(f"🩸 blood_pixels={blood_pixels}")

        if blood_pixels > BLOOD_PIXEL_THRESHOLD:
            blood_detected = True
            print("🩸 FAST BLOOD CONFIRMED")

        break

    prev_gray = gray

cap.release()

# ---------------- FINAL DECISION ----------------
print("\n===== FINAL DECISION =====")

if fight_detected and blood_detected:
    print("🚨 FAST CRITICAL ALERT: Fight + Blood")
elif fight_detected:
    print("🚓 FAST POLICE ALERT: Fight Detected")
else:
    print("NO VIOLENT ACTIVITY DETECTED")
