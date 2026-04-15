# OMR Scanner Offline Setup Script
# This script localizes heavy libraries (OpenCV.js and Lucide) for 100% offline capability.

# 1. Create directories
echo "Creating lib and icons directories..."
New-Item -ItemType Directory -Path "lib", "icons" -Force -ErrorAction SilentlyContinue

# 2. Download OpenCV.js (v4.10.0) - ~10MB
# Using documentation CDN which includes the WASM logic
echo "Downloading OpenCV.js (this may take a minute)..."
Invoke-WebRequest -Uri "https://docs.opencv.org/4.10.0/opencv.js" -OutFile "lib/opencv.js"

# 3. Download Lucide Icons
echo "Downloading Lucide icons..."
Invoke-WebRequest -Uri "https://unpkg.com/lucide@latest" -OutFile "lib/lucide.min.js"

echo ""
echo "--------------------------------------------------------"
echo "OFFLINE BUNDLING COMPLETE"
echo "--------------------------------------------------------"
echo "Next Steps:"
echo "1. Ensure you have the PWA icon files (icon-192.png and icon-512.png) in the 'icons' folder."
echo "2. Start your local development server (e.g., 'npx serve' or 'Live Server')."
echo "3. Open the app in your browser to register the Service Worker."
echo "--------------------------------------------------------"
