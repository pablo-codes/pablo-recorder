/**
 * Webcam Module - Handles camera access and video overlay composition
 * Provides draggable PiP window controls for user positioning
 */

export class WebcamManager {
  constructor() {
    this.webcamStream = null;
    this.webcamTrack = null;
    this.isEnabled = false;
    this.position = { x: 0.9, y: 0.9 }; // Normalized position (bottom-right default)
    this.size = 0.25; // Relative size (25% of screen width)
    this.overlayElement = null;
    this.videoElement = null;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
  }

  /**
   * Request camera access and initialize webcam stream
   */
  async enableWebcam() {
    if (this.isEnabled && this.webcamStream) {
      return true;
    }

    try {
      this.webcamStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: false
      });

      this.webcamTrack = this.webcamStream.getVideoTracks()[0];
      this.isEnabled = true;
      
      this.createOverlayUI();
      this.updateOverlayPosition();
      
      return true;
    } catch (err) {
      console.error('Failed to access webcam:', err);
      throw new Error(`Camera access denied: ${err.message}`);
    }
  }

  /**
   * Disable webcam and cleanup resources
   */
  disableWebcam() {
    if (this.overlayElement) {
      this.overlayElement.remove();
      this.overlayElement = null;
    }

    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach(track => track.stop());
      this.webcamStream = null;
      this.webcamTrack = null;
    }

    this.isEnabled = false;
  }

  /**
   * Create the draggable overlay UI element
   */
  createOverlayUI() {
    // Create overlay container
    this.overlayElement = document.createElement('div');
    this.overlayElement.className = 'webcam-overlay';
    this.overlayElement.style.cssText = `
      position: fixed;
      z-index: 9999;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      border: 2px solid rgba(255,255,255,0.3);
      cursor: move;
      touch-action: none;
    `;

    // Create video element
    this.videoElement = document.createElement('video');
    this.videoElement.srcObject = this.webcamStream;
    this.videoElement.autoplay = true;
    this.videoElement.playsInline = true;
    this.videoElement.muted = true;
    this.videoElement.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scaleX(-1); /* Mirror effect */
    `;

    // Create resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'webcam-resize-handle';
    resizeHandle.style.cssText = `
      position: absolute;
      bottom: 4px;
      right: 4px;
      width: 16px;
      height: 16px;
      background: rgba(0,0,0,0.5);
      border-radius: 50%;
      cursor: nwse-resize;
      z-index: 2;
    `;

    // Create close button
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '×';
    closeButton.style.cssText = `
      position: absolute;
      top: 6px;
      right: 6px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: rgba(0,0,0,0.6);
      color: white;
      border: none;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    closeButton.addEventListener('click', () => {
      const checkbox = document.getElementById('webcamToggle');
      if (checkbox) {
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change'));
      }
    });

    this.overlayElement.appendChild(this.videoElement);
    this.overlayElement.appendChild(resizeHandle);
    this.overlayElement.appendChild(closeButton);
    document.body.appendChild(this.overlayElement);

    // Setup drag functionality
    this.setupDragBehavior();
    
    // Setup resize functionality
    this.setupResizeBehavior(resizeHandle);

    // Update size
    this.updateOverlaySize();
  }

  /**
   * Setup drag behavior for the overlay
   */
  setupDragBehavior() {
    const startDrag = (e) => {
      e.preventDefault();
      this.isDragging = true;
      
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      
      const rect = this.overlayElement.getBoundingClientRect();
      this.dragOffset.x = clientX - rect.left;
      this.dragOffset.y = clientY - rect.top;
    };

    const doDrag = (e) => {
      if (!this.isDragging) return;
      e.preventDefault();

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const newX = clientX - this.dragOffset.x;
      const newY = clientY - this.dragOffset.y;

      // Keep within viewport bounds
      const maxX = window.innerWidth - this.overlayElement.offsetWidth;
      const maxY = window.innerHeight - this.overlayElement.offsetHeight;

      const clampedX = Math.max(0, Math.min(newX, maxX));
      const clampedY = Math.max(0, Math.min(newY, maxY));

      this.overlayElement.style.left = `${clampedX}px`;
      this.overlayElement.style.top = `${clampedY}px`;
      this.overlayElement.style.right = 'auto';
      this.overlayElement.style.bottom = 'auto';

      // Update normalized position
      this.position.x = (clampedX + this.overlayElement.offsetWidth / 2) / window.innerWidth;
      this.position.y = (clampedY + this.overlayElement.offsetHeight / 2) / window.innerHeight;
    };

    const stopDrag = () => {
      this.isDragging = false;
    };

    // Mouse events
    this.overlayElement.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);

    // Touch events
    this.overlayElement.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('touchmove', doDrag, { passive: false });
    document.addEventListener('touchend', stopDrag);
  }

  /**
   * Setup resize behavior for the overlay
   */
  setupResizeBehavior(handle) {
    let isResizing = false;
    let startWidth = 0;
    let startX = 0;

    const startResize = (e) => {
      e.preventDefault();
      e.stopPropagation();
      isResizing = true;
      
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      startWidth = this.overlayElement.offsetWidth;
      startX = clientX;
    };

    const doResize = (e) => {
      if (!isResizing) return;
      e.preventDefault();

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const deltaX = startX - clientX;
      const newWidth = Math.max(150, Math.min(startWidth + deltaX, window.innerWidth * 0.5));
      
      this.overlayElement.style.width = `${newWidth}px`;
      this.overlayElement.style.height = `${newWidth * 0.75}px`; // 4:3 aspect ratio
      
      // Update relative size
      this.size = newWidth / window.innerWidth;
    };

    const stopResize = () => {
      isResizing = false;
    };

    handle.addEventListener('mousedown', startResize);
    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);

    handle.addEventListener('touchstart', startResize, { passive: false });
    document.addEventListener('touchmove', doResize, { passive: false });
    document.addEventListener('touchend', stopResize);
  }

  /**
   * Update overlay position based on normalized coordinates
   */
  updateOverlayPosition() {
    if (!this.overlayElement) return;

    const width = this.overlayElement.offsetWidth || window.innerWidth * this.size;
    const height = width * 0.75;

    const x = this.position.x * window.innerWidth - width / 2;
    const y = this.position.y * window.innerHeight - height / 2;

    this.overlayElement.style.left = `${Math.max(0, Math.min(x, window.innerWidth - width))}px`;
    this.overlayElement.style.top = `${Math.max(0, Math.min(y, window.innerHeight - height))}px`;
  }

  /**
   * Update overlay size based on relative size value
   */
  updateOverlaySize() {
    if (!this.overlayElement) return;

    const width = window.innerWidth * this.size;
    const height = width * 0.75; // 4:3 aspect ratio

    this.overlayElement.style.width = `${width}px`;
    this.overlayElement.style.height = `${height}px`;
  }

  /**
   * Set webcam position preset
   * @param {string} preset - 'top-left', 'top-right', 'bottom-left', 'bottom-right'
   */
  setPositionPreset(preset) {
    const padding = 0.15; // 15% from edge
    
    switch (preset) {
      case 'top-left':
        this.position = { x: padding, y: padding };
        break;
      case 'top-right':
        this.position = { x: 1 - padding, y: padding };
        break;
      case 'bottom-left':
        this.position = { x: padding, y: 1 - padding };
        break;
      case 'bottom-right':
      default:
        this.position = { x: 1 - padding, y: 1 - padding };
        break;
    }

    this.updateOverlayPosition();
  }

  /**
   * Get the composited canvas with screen and webcam overlay
   * @param {HTMLCanvasElement} screenCanvas - Canvas with screen content
   * @returns {HTMLCanvasElement} - Composited canvas
   */
  getCompositedCanvas(screenCanvas) {
    if (!this.isEnabled || !this.webcamTrack) {
      return screenCanvas;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = screenCanvas.width;
    canvas.height = screenCanvas.height;

    // Draw screen content
    ctx.drawImage(screenCanvas, 0, 0);

    // Draw webcam overlay
    if (this.videoElement && this.videoElement.readyState >= 2) {
      const webcamWidth = canvas.width * this.size;
      const webcamHeight = webcamWidth * 0.75;
      
      const x = this.position.x * canvas.width - webcamWidth / 2;
      const y = this.position.y * canvas.height - webcamHeight / 2;

      // Save context state
      ctx.save();
      
      // Add rounded corner clipping
      ctx.beginPath();
      ctx.roundRect(x, y, webcamWidth, webcamHeight, 12);
      ctx.clip();
      
      // Draw mirrored webcam video
      ctx.translate(x + webcamWidth, y);
      ctx.scale(-1, 1);
      ctx.drawImage(this.videoElement, 0, 0, webcamWidth, webcamHeight);
      
      // Restore context
      ctx.restore();

      // Add border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, webcamWidth, webcamHeight, 12);
      ctx.stroke();
    }

    return canvas;
  }

  /**
   * Get webcam video track for recording
   * @returns {MediaStreamTrack|null}
   */
  getVideoTrack() {
    return this.webcamTrack;
  }

  /**
   * Check if webcam is active
   * @returns {boolean}
   */
  isActive() {
    return this.isEnabled && this.webcamTrack && this.webcamTrack.readyState === 'live';
  }
}

// Export singleton instance
export const webcamManager = new WebcamManager();
