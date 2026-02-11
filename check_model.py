from ultralytics import YOLO

try:
    model = YOLO("yolov8violence_final.pt")
    print("Class names:", model.names)
except Exception as e:
    print(f"Error loading model: {e}")
