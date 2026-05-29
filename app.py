"""
Aplikasi Pengolahan Citra Digital
Backend Flask dengan OpenCV + NumPy

Fitur:
- Wajib (40 poin): Input, Tampilkan, Grayscale, Citra Biner, Aritmatika, Logika
- Optional 1 (10 poin): Histogram
- Optional 2 (20 poin): Konvolusi (Mean, Sharpening, Sobel, Prewitt)
- Optional 3 (30 poin): Morfologi (Erosi & Dilasi dengan 4 SE)
"""

import io
import base64
import uuid
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, render_template, request, jsonify, send_from_directory
import matplotlib
matplotlib.use("Agg")  # backend non-GUI
import matplotlib.pyplot as plt

# ----------------------------------------------------------------------
# Konfigurasi Aplikasi
# ----------------------------------------------------------------------
BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

ALLOWED_EXT = {"png", "jpg", "jpeg", "bmp", "webp", "tiff", "tif", "gif"}
MAX_SIZE_MB = 16

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = MAX_SIZE_MB * 1024 * 1024


@app.errorhandler(413)
def request_entity_too_large(e):
    return jsonify({"error": f"Ukuran file terlalu besar. Maksimal {MAX_SIZE_MB} MB."}), 413


# ----------------------------------------------------------------------
# Helper Functions
# ----------------------------------------------------------------------
def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXT


def img_to_base64(img: np.ndarray, fmt: str = ".png") -> str:
    """Encode citra OpenCV menjadi base64 data URL."""
    if img is None:
        return ""
    success, buffer = cv2.imencode(fmt, img)
    if not success:
        return ""
    b64 = base64.b64encode(buffer.tobytes()).decode("utf-8")
    mime = "image/png" if fmt == ".png" else "image/jpeg"
    return f"data:{mime};base64,{b64}"


def load_image(image_id: str) -> np.ndarray:
    """Baca citra dari folder uploads berdasarkan id."""
    path = UPLOAD_DIR / image_id
    if not path.exists():
        return None
    img = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    # Pastikan 3 channel BGR
    if img is None:
        return None
    if len(img.shape) == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    return img


def resize_to_match(img1: np.ndarray, img2: np.ndarray):
    """Resize img2 supaya sama ukurannya dengan img1."""
    h, w = img1.shape[:2]
    img2_resized = cv2.resize(img2, (w, h), interpolation=cv2.INTER_AREA)
    return img1, img2_resized


# ----------------------------------------------------------------------
# Struktur Elemen Penstruktur (SE) - sesuai slide minggu 9-10
# ----------------------------------------------------------------------
STRUCTURING_ELEMENTS = {
    "square": np.array([
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
    ], dtype=np.uint8),
    "cross": np.array([
        [0, 1, 0],
        [1, 1, 1],
        [0, 1, 0],
    ], dtype=np.uint8),
    "diamond_x": np.array([
        [1, 0, 1],
        [0, 1, 0],
        [1, 0, 1],
    ], dtype=np.uint8),
    "vertical": np.array([
        [0, 1, 0],
        [0, 1, 0],
        [0, 1, 0],
    ], dtype=np.uint8),
    "horizontal": np.array([
        [0, 0, 0],
        [1, 1, 1],
        [0, 0, 0],
    ], dtype=np.uint8),
    "diag_pos": np.array([
        [0, 0, 1],
        [0, 1, 0],
        [1, 0, 0],
    ], dtype=np.uint8),
    "diag_neg": np.array([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
    ], dtype=np.uint8),
}


# ----------------------------------------------------------------------
# Kernel Konvolusi - sesuai slide minggu 9-10
# ----------------------------------------------------------------------
KERNELS = {
    "mean": np.ones((3, 3), np.float32) / 9.0,  # Mean / Blur filter
    "sharpen_standard": np.array([
        [0, -1, 0],
        [-1, 5, -1],
        [0, -1, 0],
    ], dtype=np.float32),
    "sharpen_strong": np.array([
        [-1, -1, -1],
        [-1, 9, -1],
        [-1, -1, -1],
    ], dtype=np.float32),
}


# ======================================================================
# ROUTES
# ======================================================================
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/uploads/<filename>")
def get_upload(filename):
    return send_from_directory(UPLOAD_DIR, filename)


# ----------------------------------------------------------------------
# Fitur Wajib (a) Input Gambar
# ----------------------------------------------------------------------
@app.route("/api/upload", methods=["POST"])
def api_upload():
    """Upload gambar - menerima file dan return id + preview."""
    if "image" not in request.files:
        return jsonify({"error": "Tidak ada file yang dikirim"}), 400

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"error": "Nama file kosong"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "Format tidak didukung. Gunakan: PNG, JPG, BMP, WEBP, TIFF, atau GIF"}), 400

    # Simpan dengan UUID
    ext = file.filename.rsplit(".", 1)[1].lower()
    image_id = f"{uuid.uuid4().hex}.{ext}"
    path = UPLOAD_DIR / image_id
    file.save(str(path))

    # Baca info citra
    img = load_image(image_id)
    if img is None:
        return jsonify({"error": "Gagal membaca file gambar"}), 400

    h, w = img.shape[:2]
    channels = img.shape[2] if len(img.shape) > 2 else 1

    return jsonify({
        "success": True,
        "image_id": image_id,
        "filename": file.filename,
        "width": w,
        "height": h,
        "channels": channels,
        "preview": img_to_base64(img),
    })


# ----------------------------------------------------------------------
# Fitur Wajib (c) Proses Gambar - Grayscale
# ----------------------------------------------------------------------
@app.route("/api/grayscale", methods=["POST"])
def api_grayscale():
    """Konversi citra ke grayscale menggunakan rumus luminositas."""
    data = request.json or {}
    image_id = data.get("image_id")
    img = load_image(image_id)
    if img is None:
        return jsonify({"error": "Gambar tidak ditemukan"}), 404

    # Konversi grayscale (BGR ke Grayscale)
    # Rumus: Y = 0.299*R + 0.587*G + 0.114*B
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Konversi balik ke 3 channel untuk tampilan konsisten
    gray_3ch = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

    return jsonify({
        "success": True,
        "result": img_to_base64(gray_3ch),
        "info": "Grayscale (Y = 0.299R + 0.587G + 0.114B)",
    })


# ----------------------------------------------------------------------
# Fitur Wajib (c) Proses Gambar - Citra Biner (Thresholding)
# ----------------------------------------------------------------------
@app.route("/api/binary", methods=["POST"])
def api_binary():
    """Konversi ke citra biner via thresholding (manual atau Otsu)."""
    data = request.json or {}
    image_id = data.get("image_id")
    threshold = int(data.get("threshold", 127))
    method = data.get("method", "manual")  # manual | otsu

    img = load_image(image_id)
    if img is None:
        return jsonify({"error": "Gambar tidak ditemukan"}), 404

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    if method == "otsu":
        used_thresh, binary = cv2.threshold(
            gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        info = f"Otsu (T otomatis = {int(used_thresh)})"
    else:
        used_thresh, binary = cv2.threshold(
            gray, threshold, 255, cv2.THRESH_BINARY
        )
        info = f"Manual (T = {threshold})"

    binary_3ch = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)

    return jsonify({
        "success": True,
        "result": img_to_base64(binary_3ch),
        "info": f"Citra Biner - {info}",
        "threshold_used": int(used_thresh),
    })


# ----------------------------------------------------------------------
# Fitur Wajib (c) Proses Gambar - Operasi Aritmatika
# ----------------------------------------------------------------------
@app.route("/api/arithmetic", methods=["POST"])
def api_arithmetic():
    """
    Operasi aritmatika.
    Mode 'constant': operasi gambar dengan nilai konstanta.
    Mode 'dual': operasi antara 2 gambar.
    Operasi: add (+), subtract (-), multiply (×), divide (÷)
    """
    data = request.json or {}
    image_id = data.get("image_id")
    operation = data.get("operation", "add")
    mode = data.get("mode", "constant")  # constant | dual

    img = load_image(image_id)
    if img is None:
        return jsonify({"error": "Gambar utama tidak ditemukan"}), 404

    img_f = img.astype(np.float32)

    if mode == "constant":
        try:
            value = float(data.get("value", 50))
        except (TypeError, ValueError):
            return jsonify({"error": "Nilai konstanta tidak valid"}), 400

        if operation == "add":
            result = img_f + value
            info = f"Citra + {value}"
        elif operation == "subtract":
            result = img_f - value
            info = f"Citra - {value}"
        elif operation == "multiply":
            result = img_f * value
            info = f"Citra × {value}"
        elif operation == "divide":
            if value == 0:
                return jsonify({"error": "Tidak bisa membagi dengan nol"}), 400
            result = img_f / value
            info = f"Citra ÷ {value}"
        else:
            return jsonify({"error": "Operasi tidak dikenali"}), 400
    else:  # dual
        image_id2 = data.get("image_id2")
        img2 = load_image(image_id2)
        if img2 is None:
            return jsonify({"error": "Gambar kedua belum diupload"}), 404
        img_f, img2_resized = resize_to_match(img_f, img2.astype(np.float32))

        if operation == "add":
            result = img_f + img2_resized
            info = "Citra 1 + Citra 2"
        elif operation == "subtract":
            result = img_f - img2_resized
            info = "Citra 1 - Citra 2"
        elif operation == "multiply":
            # Normalisasi agar tidak overflow ekstrim
            result = (img_f * img2_resized) / 255.0
            info = "Citra 1 × Citra 2 (dinormalisasi)"
        elif operation == "divide":
            # +1 untuk menghindari pembagian nol
            result = (img_f / (img2_resized + 1.0)) * 255.0
            info = "Citra 1 ÷ Citra 2"
        else:
            return jsonify({"error": "Operasi tidak dikenali"}), 400

    # Clipping 0-255 dan konversi balik
    result = np.clip(result, 0, 255).astype(np.uint8)

    return jsonify({
        "success": True,
        "result": img_to_base64(result),
        "info": f"Aritmatika: {info}",
    })


# ----------------------------------------------------------------------
# Fitur Wajib (c) Proses Gambar - Operasi Logika
# ----------------------------------------------------------------------
@app.route("/api/logical", methods=["POST"])
def api_logical():
    """
    Operasi logika bitwise.
    Mode 'constant': operasi dengan nilai konstanta (0-255).
    Mode 'dual': operasi antara 2 gambar.
    Operasi: and, or, xor, not
    """
    data = request.json or {}
    image_id = data.get("image_id")
    operation = data.get("operation", "and")
    mode = data.get("mode", "constant")

    img = load_image(image_id)
    if img is None:
        return jsonify({"error": "Gambar utama tidak ditemukan"}), 404

    if operation == "not":
        result = cv2.bitwise_not(img)
        info = "NOT Citra (invert)"
    else:
        if mode == "constant":
            try:
                value = int(data.get("value", 128)) & 0xFF
            except (TypeError, ValueError):
                return jsonify({"error": "Nilai konstanta tidak valid"}), 400

            mask = np.full_like(img, value, dtype=np.uint8)
            label = f"konstanta {value}"
        else:
            image_id2 = data.get("image_id2")
            img2 = load_image(image_id2)
            if img2 is None:
                return jsonify({"error": "Gambar kedua belum diupload"}), 404
            img, mask = resize_to_match(img, img2)
            label = "Citra 2"

        if operation == "and":
            result = cv2.bitwise_and(img, mask)
            info = f"Citra AND {label}"
        elif operation == "or":
            result = cv2.bitwise_or(img, mask)
            info = f"Citra OR {label}"
        elif operation == "xor":
            result = cv2.bitwise_xor(img, mask)
            info = f"Citra XOR {label}"
        else:
            return jsonify({"error": "Operasi tidak dikenali"}), 400

    return jsonify({
        "success": True,
        "result": img_to_base64(result),
        "info": f"Logika: {info}",
    })


# ----------------------------------------------------------------------
# Fitur Optional 1 - Histogram (10 poin)
# ----------------------------------------------------------------------
@app.route("/api/histogram", methods=["POST"])
def api_histogram():
    """
    Generate histogram RGB & Grayscale.
    Menerima image_id (dari uploads) ATAU output_file (dari output) -
    supaya histogram bisa dihitung untuk gambar asli & hasil olahan.
    """
    data = request.json or {}
    image_id = data.get("image_id")
    image_data = data.get("image_data")  # base64 data URL

    if image_data:
        # Decode base64 data URL
        if "," in image_data:
            image_data = image_data.split(",", 1)[1]
        try:
            img_bytes = base64.b64decode(image_data)
            img_array = np.frombuffer(img_bytes, dtype=np.uint8)
            img = cv2.imdecode(img_array, cv2.IMREAD_UNCHANGED)
            if img is not None and len(img.shape) == 2:
                img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
            elif img is not None and img.shape[2] == 4:
                img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
        except Exception:
            return jsonify({"error": "Gagal mendekode data gambar"}), 400
    elif image_id:
        img = load_image(image_id)
    else:
        return jsonify({"error": "Sumber gambar tidak ditentukan"}), 400

    if img is None:
        return jsonify({"error": "Gambar tidak ditemukan"}), 404

    # Buat figure dengan 2 subplot: RGB & Grayscale
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))
    fig.patch.set_facecolor("#faf7f2")

    # Histogram RGB
    colors = ("blue", "green", "red")  # OpenCV = BGR
    color_labels = ("Blue", "Green", "Red")
    for i, (col, lbl) in enumerate(zip(colors, color_labels)):
        hist = cv2.calcHist([img], [i], None, [256], [0, 256])
        axes[0].plot(hist, color=col, label=lbl, linewidth=1.2)
    axes[0].set_title("Histogram RGB", fontsize=12, fontweight="bold")
    axes[0].set_xlabel("Intensitas Piksel (0-255)")
    axes[0].set_ylabel("Frekuensi")
    axes[0].set_xlim([0, 256])
    axes[0].legend()
    axes[0].grid(True, alpha=0.3)
    axes[0].set_facecolor("#ffffff")

    # Histogram Grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    hist_gray = cv2.calcHist([gray], [0], None, [256], [0, 256])
    axes[1].fill_between(range(256), hist_gray.flatten(), color="#2d2d2d", alpha=0.8)
    axes[1].set_title("Histogram Grayscale", fontsize=12, fontweight="bold")
    axes[1].set_xlabel("Intensitas Piksel (0-255)")
    axes[1].set_ylabel("Frekuensi")
    axes[1].set_xlim([0, 256])
    axes[1].grid(True, alpha=0.3)
    axes[1].set_facecolor("#ffffff")

    plt.tight_layout()
    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=100, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    buf.seek(0)

    b64 = base64.b64encode(buf.read()).decode("utf-8")

    # Statistik
    stats = {
        "min": int(gray.min()),
        "max": int(gray.max()),
        "mean": round(float(gray.mean()), 2),
        "std": round(float(gray.std()), 2),
    }

    return jsonify({
        "success": True,
        "result": f"data:image/png;base64,{b64}",
        "info": "Histogram RGB & Grayscale",
        "stats": stats,
    })


# ----------------------------------------------------------------------
# Fitur Optional 2 - Konvolusi & Filter Spasial (20 poin)
# ----------------------------------------------------------------------
@app.route("/api/convolution", methods=["POST"])
def api_convolution():
    """
    Aplikasikan filter konvolusi.
    Pilihan: mean, sharpen_standard, sharpen_strong, sobel, prewitt
    """
    data = request.json or {}
    image_id = data.get("image_id")
    filter_type = data.get("filter", "mean")

    img = load_image(image_id)
    if img is None:
        return jsonify({"error": "Gambar tidak ditemukan"}), 404

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    if filter_type in ("mean", "sharpen_standard", "sharpen_strong"):
        kernel = KERNELS[filter_type]
        result = cv2.filter2D(img, -1, kernel)
        labels = {
            "mean": "Mean Filter / Blur (3×3 average)",
            "sharpen_standard": "Sharpening Standar [[0,-1,0],[-1,5,-1],[0,-1,0]]",
            "sharpen_strong": "Sharpening Kuat [[-1,-1,-1],[-1,9,-1],[-1,-1,-1]]",
        }
        info = labels[filter_type]
        kernel_display = kernel.tolist()

    elif filter_type == "sobel_vertical":
        # Kernel Sobel Vertikal: mendeteksi tepi vertikal (perubahan horizontal)
        sobel_v = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=np.float32)
        gx = cv2.filter2D(gray.astype(np.float32), -1, sobel_v)
        magnitude = np.clip(np.abs(gx), 0, 255).astype(np.uint8)
        result = cv2.cvtColor(magnitude, cv2.COLOR_GRAY2BGR)
        info = "Sobel Vertikal — mendeteksi tepi vertikal (Gx)"
        kernel_display = sobel_v.tolist()

    elif filter_type == "sobel_horizontal":
        # Kernel Sobel Horizontal: mendeteksi tepi horizontal (perubahan vertikal)
        sobel_h = np.array([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], dtype=np.float32)
        gy = cv2.filter2D(gray.astype(np.float32), -1, sobel_h)
        magnitude = np.clip(np.abs(gy), 0, 255).astype(np.uint8)
        result = cv2.cvtColor(magnitude, cv2.COLOR_GRAY2BGR)
        info = "Sobel Horizontal — mendeteksi tepi horizontal (Gy)"
        kernel_display = sobel_h.tolist()

    elif filter_type == "sobel":
        # Kombinasi: magnitude dari Gx dan Gy
        sobel_h = np.array([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], dtype=np.float32)
        sobel_v = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=np.float32)
        gx = cv2.filter2D(gray.astype(np.float32), -1, sobel_v)
        gy = cv2.filter2D(gray.astype(np.float32), -1, sobel_h)
        magnitude = np.sqrt(gx ** 2 + gy ** 2)
        magnitude = np.clip(magnitude, 0, 255).astype(np.uint8)
        result = cv2.cvtColor(magnitude, cv2.COLOR_GRAY2BGR)
        info = "Sobel Kombinasi — G = √(Gx² + Gy²)"
        kernel_display = {"Gx (vertikal)": sobel_v.tolist(), "Gy (horizontal)": sobel_h.tolist()}

    elif filter_type == "prewitt":
        prewitt_h = np.array([[-1, -1, -1], [0, 0, 0], [1, 1, 1]], dtype=np.float32)
        prewitt_v = np.array([[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]], dtype=np.float32)
        gx = cv2.filter2D(gray.astype(np.float32), -1, prewitt_v)
        gy = cv2.filter2D(gray.astype(np.float32), -1, prewitt_h)
        magnitude = np.sqrt(gx ** 2 + gy ** 2)
        magnitude = np.clip(magnitude, 0, 255).astype(np.uint8)
        result = cv2.cvtColor(magnitude, cv2.COLOR_GRAY2BGR)
        info = "Edge Detection - Prewitt (G = √(Gx² + Gy²))"
        kernel_display = {"Gx (vertikal)": prewitt_v.tolist(), "Gy (horizontal)": prewitt_h.tolist()}

    else:
        return jsonify({"error": "Filter tidak dikenali"}), 400

    return jsonify({
        "success": True,
        "result": img_to_base64(result),
        "info": f"Konvolusi: {info}",
        "kernel": kernel_display,
    })


# ----------------------------------------------------------------------
# Fitur Optional 3 - Operasi Morfologi (30 poin)
# ----------------------------------------------------------------------
@app.route("/api/morphology", methods=["POST"])
def api_morphology():
    """
    Operasi morfologi: erosi, dilasi, opening, closing.
    SE: square, cross, diamond_x, vertical, horizontal, diag_pos, diag_neg
    """
    data = request.json or {}
    image_id = data.get("image_id")
    operation = data.get("operation", "erosion")  # erosion | dilation | opening | closing
    se_name = data.get("se", "square")
    iterations = int(data.get("iterations", 1))
    threshold = int(data.get("threshold", 127))

    img = load_image(image_id)
    if img is None:
        return jsonify({"error": "Gambar tidak ditemukan"}), 404

    if se_name not in STRUCTURING_ELEMENTS:
        return jsonify({"error": "Elemen penstruktur tidak dikenali"}), 400

    se = STRUCTURING_ELEMENTS[se_name]

    # Morfologi bekerja pada citra biner -> konversi dulu
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)

    if operation == "erosion":
        result = cv2.erode(binary, se, iterations=iterations)
        op_label = "Erosi (Pengikisan objek - operator AND)"
    elif operation == "dilation":
        result = cv2.dilate(binary, se, iterations=iterations)
        op_label = "Dilasi (Penebalan objek - operator OR)"
    elif operation == "opening":
        result = cv2.morphologyEx(binary, cv2.MORPH_OPEN, se, iterations=iterations)
        op_label = "Opening (Erosi → Dilasi)"
    elif operation == "closing":
        result = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, se, iterations=iterations)
        op_label = "Closing (Dilasi → Erosi)"
    else:
        return jsonify({"error": "Operasi morfologi tidak dikenali"}), 400

    result_3ch = cv2.cvtColor(result, cv2.COLOR_GRAY2BGR)

    se_labels = {
        "square": "Square 3×3 (full)",
        "cross": "Cross / Plus",
        "diamond_x": "Diamond X",
        "vertical": "Vertical Line",
        "horizontal": "Horizontal Line",
        "diag_pos": "Diagonal Positif",
        "diag_neg": "Diagonal Negatif",
    }

    return jsonify({
        "success": True,
        "result": img_to_base64(result_3ch),
        "binary_input": img_to_base64(cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)),
        "info": f"Morfologi: {op_label} | SE: {se_labels[se_name]} | Iterasi: {iterations}",
        "se_matrix": se.tolist(),
    })


# ----------------------------------------------------------------------
# Endpoint untuk daftar SE dan kernel (untuk preview di UI)
# ----------------------------------------------------------------------
@app.route("/api/structuring_elements")
def api_se_list():
    return jsonify({
        name: se.tolist() for name, se in STRUCTURING_ELEMENTS.items()
    })


# ======================================================================
# Main
# ======================================================================
if __name__ == "__main__":
    print("=" * 60)
    print("  Aplikasi Pengolahan Citra Digital")
    print("  Server berjalan di: http://127.0.0.1:5000")
    print("=" * 60)
    app.run(debug=True, host="127.0.0.1", port=5000)
