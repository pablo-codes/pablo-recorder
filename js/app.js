/**
 * Main Application Entry Point for PabloRec
 * Initializes UI, handles user interactions, and coordinates modules
 */

import { screenRecorder } from './recorder.js';
import { webcamManager } from './webcam.js';
import { sanitizeFilename, showToast } from './utils.js';

// DOM Elements
const elements = {};

function initializeElements() {
  elements.btnStart = document.getElementById('btnStart');
  elements.btnPause = document.getElementById('btnPause');
  elements.btnStop = document.getElementById('btnStop');
  elements.pauseBtnText = document.getElementById('pauseBtnText');
  elements.recordingControls = document.getElementById('recordingControls');
  elements.statusText = document.getElementById('statusText');
  elements.statusIndicator = document.getElementById('statusIndicator');
  elements.timerDisplay = document.getElementById('timerDisplay');

  elements.themeToggle = document.getElementById('themeToggle');
  elements.themeIconSun = document.getElementById('themeIconSun');
  elements.themeIconMoon = document.getElementById('themeIconMoon');

  elements.formatSelect = document.getElementById('formatSelect');
  elements.formatInfo = document.getElementById('formatInfo');
  elements.formatWarning = document.getElementById('formatWarning');
  elements.qualitySelect = document.getElementById('qualitySelect');
  elements.fpsSelect = document.getElementById('fpsSelect');
  elements.fpsWarning = document.getElementById('fpsWarning');
  elements.micToggle = document.getElementById('micToggle');
  elements.filterToggle = document.getElementById('filterToggle');
  elements.systemAudioToggle = document.getElementById('systemAudioToggle');
  elements.webcamToggle = document.getElementById('webcamToggle');
  elements.filterControls = document.getElementById('filterControls');
  elements.webcamControls = document.getElementById('webcamControls');

  elements.highpassSlider = document.getElementById('highpassSlider');
  elements.lowpassSlider = document.getElementById('lowpassSlider');
  elements.gainSlider = document.getElementById('gainSlider');
  elements.highpassVal = document.getElementById('highpassVal');
  elements.lowpassVal = document.getElementById('lowpassVal');
  elements.gainVal = document.getElementById('gainVal');

  elements.visualizer = document.getElementById('visualizer');
  elements.visualizerPlaceholder = document.getElementById('visualizerPlaceholder');
  elements.previewModalOverlay = document.getElementById('previewModalOverlay');
  elements.previewVideo = document.getElementById('previewVideo');
  elements.filenameInput = document.getElementById('filenameInput');
  elements.btnDownload = document.getElementById('btnDownload');
  elements.btnDiscard = document.getElementById('btnDiscard');
  elements.toastContainer = document.getElementById('toastContainer');

  // Webcam position preset buttons
  elements.presetTopLeft = document.getElementById('presetTopLeft');
  elements.presetTopRight = document.getElementById('presetTopRight');
  elements.presetBottomLeft = document.getElementById('presetBottomLeft');
  elements.presetBottomRight = document.getElementById('presetBottomRight');
}

/* --- Theme Management --- */
function initTheme() {
  const savedTheme = localStorage.getItem('recorder-theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeUI(savedTheme);

  elements.themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('recorder-theme', newTheme);
    updateThemeUI(newTheme);
  });
}

function updateThemeUI(theme) {
  if (theme === 'dark') {
    elements.themeIconSun.style.display = 'block';
    elements.themeIconMoon.style.display = 'none';
  } else {
    elements.themeIconSun.style.display = 'none';
    elements.themeIconMoon.style.display = 'block';
  }
}

/* --- Capabilities Check --- */
function runBrowserCapabilityCheck() {
  const { supportsWebCodecs, supportsNativeMp4, useWebCodecsForMp4 } = screenRecorder;

  if (supportsWebCodecs) {
    elements.formatInfo.textContent = 'Supported via hardware WebCodecs (Chromium-based).';
    elements.formatInfo.style.color = 'var(--success)';
    elements.formatInfo.style.display = 'block';
  } else if (supportsNativeMp4) {
    elements.formatInfo.textContent = 'Supported via browser native MediaRecorder.';
    elements.formatInfo.style.color = 'var(--text-secondary)';
    elements.formatInfo.style.display = 'block';
  } else {
    const mp4Option = elements.formatSelect.querySelector('option[value="mp4"]');
    if (mp4Option) mp4Option.disabled = true;
    elements.formatWarning.style.display = 'block';
    elements.formatInfo.style.display = 'none';
  }
}

/* --- Event Listeners Setup --- */
function setupEventListeners() {
  // Format select
  elements.formatSelect.addEventListener('change', () => {
    if (elements.formatSelect.value === 'mp4') {
      if (screenRecorder.supportsWebCodecs) {
        elements.formatInfo.textContent = 'Supported via hardware WebCodecs (Chromium-based).';
        elements.formatInfo.style.color = 'var(--success)';
        elements.formatInfo.style.display = 'block';
      } else if (screenRecorder.supportsNativeMp4) {
        elements.formatInfo.textContent = 'Supported via browser native MediaRecorder.';
        elements.formatInfo.style.color = 'var(--text-secondary)';
        elements.formatInfo.style.display = 'block';
      }
      elements.formatWarning.style.display = 'none';
    } else {
      elements.formatInfo.style.display = 'none';
      elements.formatWarning.style.display = 'none';
    }
  });

  // FPS warning
  elements.fpsSelect.addEventListener('change', () => {
    elements.fpsWarning.style.display = elements.fpsSelect.value === '60' ? 'block' : 'none';
  });

  // Audio filter sliders
  elements.highpassSlider.addEventListener('input', (e) => {
    elements.highpassVal.textContent = `${e.target.value} Hz`;
    screenRecorder.updateFilters();
  });
  elements.lowpassSlider.addEventListener('input', (e) => {
    elements.lowpassVal.textContent = `${e.target.value} Hz`;
    screenRecorder.updateFilters();
  });
  elements.gainSlider.addEventListener('input', (e) => {
    elements.gainVal.textContent = `${parseFloat(e.target.value).toFixed(1)}x`;
    screenRecorder.updateFilters();
  });

  // Mic toggle
  elements.micToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      elements.filterControls.style.display = 'flex';
      screenRecorder.setupMicrophoneVisualizerPreview();
    } else {
      elements.filterControls.style.display = 'none';
      screenRecorder.stopMicrophoneVisualizerPreview();
    }
  });

  // Filter toggle
  elements.filterToggle.addEventListener('change', () => {
    screenRecorder.updateFilters();
  });

  // Webcam toggle
  elements.webcamToggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      try {
        await webcamManager.enableWebcam();
        elements.webcamControls.style.display = 'flex';
        // Set default position to bottom-right
        webcamManager.setPositionPreset('bottom-right');
        showToast('Webcam enabled. Drag to reposition, resize from corner.', 'info');
      } catch (err) {
        showToast(`Webcam error: ${err.message}`, 'error');
        e.target.checked = false;
      }
    } else {
      webcamManager.disableWebcam();
      elements.webcamControls.style.display = 'none';
    }
  });

  // Webcam position presets
  if (elements.presetTopLeft) {
    elements.presetTopLeft.addEventListener('click', () => {
      webcamManager.setPositionPreset('top-left');
    });
  }
  if (elements.presetTopRight) {
    elements.presetTopRight.addEventListener('click', () => {
      webcamManager.setPositionPreset('top-right');
    });
  }
  if (elements.presetBottomLeft) {
    elements.presetBottomLeft.addEventListener('click', () => {
      webcamManager.setPositionPreset('bottom-left');
    });
  }
  if (elements.presetBottomRight) {
    elements.presetBottomRight.addEventListener('click', () => {
      webcamManager.setPositionPreset('bottom-right');
    });
  }

  // Recording buttons
  elements.btnStart.addEventListener('click', startRecording);
  elements.btnPause.addEventListener('click', () => screenRecorder.togglePause());
  elements.btnStop.addEventListener('click', () => screenRecorder.stopRecording());

  // Preview modal actions
  elements.btnDownload.addEventListener('click', downloadRecording);
  elements.btnDiscard.addEventListener('click', () => {
    if (confirm('Are you sure you want to discard this recording?')) {
      closePreviewModal();
      showToast('Recording discarded.', 'info');
    }
  });
}

/* --- Recording Flow --- */
async function startRecording() {
  const format = elements.formatSelect.value;
  const fps = parseInt(elements.fpsSelect.value);
  const quality = elements.qualitySelect.value;
  const includeWebcam = elements.webcamToggle && elements.webcamToggle.checked;
  const micEnabled = elements.micToggle && elements.micToggle.checked;
  const systemAudio = elements.systemAudioToggle && elements.systemAudioToggle.checked;

  try {
    await screenRecorder.startRecording({
      format,
      fps,
      quality,
      includeWebcam,
      micEnabled,
      systemAudio
    });
  } catch (err) {
    console.error('Failed to start recording:', err);
  }
}

/* --- Download Flow --- */
function downloadRecording() {
  const fileUrl = elements.previewVideo.src;
  if (!fileUrl) return;

  let filename = sanitizeFilename(elements.filenameInput.value.trim());
  if (!filename) filename = 'screen-recording';

  const ext = document.getElementById('downloadExtension').textContent;

  const downloadLink = document.createElement('a');
  downloadLink.style.display = 'none';
  downloadLink.href = fileUrl;
  downloadLink.download = `${filename}${ext}`;

  document.body.appendChild(downloadLink);
  downloadLink.click();

  setTimeout(() => {
    document.body.removeChild(downloadLink);
  }, 100);

  showToast('Recording downloaded successfully!', 'success');
  closePreviewModal();
}

function closePreviewModal() {
  elements.previewModalOverlay.classList.remove('active');

  if (elements.previewVideo.src) {
    URL.revokeObjectURL(elements.previewVideo.src);
    elements.previewVideo.src = '';
  }
}

/* --- Initialization --- */
function init() {
  initializeElements();
  initTheme();
  
  // Initialize visualizer
  screenRecorder.initVisualizer(elements.visualizer);
  screenRecorder.startIdleVisualizer();
  
  runBrowserCapabilityCheck();
  setupEventListeners();
  
  // Initial mic preview setup (will return immediately if unchecked)
  screenRecorder.setupMicrophoneVisualizerPreview();
  
  console.log('PabloRec initialized successfully');
}

// Start the application
init();
