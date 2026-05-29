# Aplikasi Pengolahan Citra Digital

Aplikasi web pengolahan citra digital berbasis Python Flask dengan OpenCV.

## Instalasi & Menjalankan

**1. Prasyarat** — pastikan Python 3.8+ terinstal:
```bash
python --version
```

**2. (Opsional) Buat virtual environment:**
```bash
python -m venv venv
venv\Scripts\activate
```

**3. Install dependensi:**
```bash
pip install -r requirements.txt
```

**4. Jalankan aplikasi:**
```bash
python app.py
```

**5.** Buka browser: `http://127.0.0.1:5000`

> Untuk menghentikan aplikasi tekan `Ctrl + C` di terminal.

## Fitur

**Wajib**
- Upload gambar (PNG, JPG, BMP, WEBP, TIFF, GIF — maks 16MB)
- Konversi Grayscale (Y = 0.299R + 0.587G + 0.114B)
- Citra Biner — thresholding manual atau Otsu
- Operasi Aritmatika — tambah, kurang, kali, bagi (dengan konstanta atau gambar kedua)
- Operasi Logika — AND, OR, XOR, NOT (bitwise)

**Opsional**
- Histogram RGB & Grayscale + statistik intensitas
- Konvolusi / Filter — Mean, Sharpening, Sobel, Prewitt
- Morfologi — Erosi, Dilasi, Opening, Closing (7 pilihan Structuring Element)

## Teknologi

| | |
|---|---|
| Backend | Python 3, Flask |
| Pemrosesan Citra | OpenCV, NumPy |
| Visualisasi | Matplotlib |
| Frontend | HTML, CSS, JavaScript |

## Struktur Proyek

```
image_processing_app/
├── app.py              # Backend Flask + semua endpoint API
├── requirements.txt
├── templates/index.html
├── static/css/ & js/
└── uploads/            # Gambar yang diunggah
```
