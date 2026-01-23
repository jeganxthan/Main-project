from flask import Flask, jsonify, send_file
from flask_cors import CORS
from ai_engine import run_ai_detection
import os
import glob

app = Flask(__name__)
CORS(app)

@app.route("/run-ai", methods=["GET"])
def run_ai():
    """
    Trigger FAST AI detection
    """
    result = run_ai_detection()
    
    # Add the latest enhanced image path if blood detected
    if result.get("blood") and result.get("frame"):
        frame_num = result["frame"]
        enhanced_path = f"enhanced/enhanced_{frame_num}.jpg"
        if os.path.exists(enhanced_path):
            result["image_url"] = f"/image/{frame_num}"
    
    return jsonify(result)

@app.route("/image/<int:frame_num>", methods=["GET"])
def get_image(frame_num):
    """
    Serve enhanced image for a specific frame
    """
    image_path = f"enhanced/enhanced_{frame_num}.jpg"
    if os.path.exists(image_path):
        return send_file(image_path, mimetype='image/jpeg')
    return jsonify({"error": "Image not found"}), 404

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
