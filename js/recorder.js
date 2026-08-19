/**
 * Recorder Module - Main recording engine for PabloRec
 * Handles screen capture, audio mixing, and video encoding
 */

import { webcamManager } from './webcam.js';
import { formatTime, showToast, checkCapabilities } from './utils.js';

export class ScreenRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.videoStream = null;
    this.microphoneStream = null;
    this.audioContext = null;
    this.destinationNode = null;
    this.audioTracks = [];

    // Timer variables
    this.startTime = 0;
    this.elapsedTime = 0;
    this.timerInterval = null;

    // Visualizer variables
    this.canvasCtx = null;
    this.analyserNode = null;
    this.visualizerAnimationId = null;

    // Capabilities
    const capabilities = checkCapabilities();
    this.supportsWebCodecs = capabilities.supportsWebCodecs;
    this.supportsNativeMp4 = capabilities.supportsNativeMp4;
    this.useWebCodecsForMp4 = capabilities.useWebCodecsForMp4;

    // WebCodecs Processing Engines
    this.videoEncoder = null;
    this.audioEncoder = null;
    this.videoReader = null;
    this.audioReader = null;
    this.muxer = null;

    // Pause/resume timeline management for WebCodecs
    this.recordingState = 'inactive'; // 'inactive', 'recording', 'paused', 'stopped'
    this.totalPauseDurationUs = 0;
    this.pauseStartUs = 0;

    // Filter nodes
    this.filterHighpassNode = null;
    this.filterLowpassNode = null;
    this.filterGainNode = null;

    // Preview mic stream
    this.previewMicStream = null;
    this.previewContext = null;
  }

  /**
   * Initialize visualizer canvas
   * @param {HTMLCanvasElement} canvas - Visualizer canvas element
   */
  initVisualizer(canvas) {
    this.canvasCtx = canvas.getContext('2d');
    this.resizeCanvas(canvas);
    window.addEventListener('resize', () => this.resizeCanvas(canvas));
  }

  resizeCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    if (this.canvasCtx) {
      this.canvasCtx.scale(dpr, dpr);
    }
  }

  /**
   * Start idle visualizer animation
   */
  startIdleVisualizer() {
    let x = 0;
    const drawIdle = () => {
      if (this.analyserNode) return;

      const width = this.canvasCtx.canvas.width / (window.devicePixelRatio || 1);
      const height = this.canvasCtx.canvas.height / (window.devicePixelRatio || 1);

      this.canvasCtx.clearRect(0, 0, width, height);
      this.canvasCtx.beginPath();
      this.canvasCtx.moveTo(0, height / 2);

      for (let i = 0; i < width; i++) {
        const amplitude = Math.sin(x * 0.02) * 5 + 2;
        const y = height / 2 + Math.sin(i * 0.015 + x * 0.05) * amplitude;
        this.canvasCtx.lineTo(i, y);
      }

      this.canvasCtx.strokeStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--text-muted')
        .trim() + '33';
      this.canvasCtx.lineWidth = 2;
      this.canvasCtx.stroke();

      x++;
      this.visualizerAnimationId = requestAnimationFrame(drawIdle);
    };
    drawIdle();
  }

  /**
   * Draw waveform from audio analyser
   */
  drawWaveform() {
    if (!this.analyserNode) return;

    const animate = () => {
      if (!this.analyserNode) return;
      this.visualizerAnimationId = requestAnimationFrame(animate);

      const bufferLength = this.analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      if (this.recordingState === 'paused') {
        dataArray.fill(128);
      } else {
        this.analyserNode.getByteTimeDomainData(dataArray);
      }

      const width = this.canvasCtx.canvas.width / (window.devicePixelRatio || 1);
      const height = this.canvasCtx.canvas.height / (window.devicePixelRatio || 1);

      this.canvasCtx.clearRect(0, 0, width, height);

      this.canvasCtx.strokeStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--panel-border')
        .trim();
      this.canvasCtx.lineWidth = 0.5;

      this.canvasCtx.beginPath();
      this.canvasCtx.moveTo(0, height / 2);
      this.canvasCtx.lineTo(width, height / 2);
      this.canvasCtx.stroke();

      this.canvasCtx.lineWidth = 3;
      const waveColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--visualizer-wave')
        .trim();
      this.canvasCtx.strokeStyle = waveColor;
      this.canvasCtx.beginPath();

      const sliceWidth = width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * height) / 2;

        if (i === 0) {
          this.canvasCtx.moveTo(x, y);
        } else {
          this.canvasCtx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      this.canvasCtx.lineTo(width, height / 2);
      this.canvasCtx.stroke();
    };
    animate();
  }

  /**
   * Setup microphone preview for visualizer
   */
  async setupMicrophoneVisualizerPreview() {
    if (this.recordingState !== 'inactive') return;
    
    const micToggle = document.getElementById('micToggle');
    if (!micToggle || !micToggle.checked) {
      this.stopMicrophoneVisualizerPreview();
      return;
    }

    try {
      if (
        this.previewMicStream &&
        this.previewMicStream.getAudioTracks().length > 0 &&
        this.previewMicStream.getAudioTracks()[0].readyState === 'live'
      ) {
        if (!this.previewContext || this.previewContext.state === 'closed') {
          this.previewContext = new (window.AudioContext || window.webkitAudioContext)();
          const previewSource = this.previewContext.createMediaStreamSource(this.previewMicStream);
          this.analyserNode = this.previewContext.createAnalyser();
          this.analyserNode.fftSize = 1024;
          previewSource.connect(this.analyserNode);
        }
        document.getElementById('visualizerPlaceholder').textContent = 'Mic Live';
        if (this.visualizerAnimationId) cancelAnimationFrame(this.visualizerAnimationId);
        this.drawWaveform();
        return;
      }

      this.stopMicrophoneVisualizerPreview();
      if (!micToggle.checked) return;

      this.previewMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      this.previewContext = new (window.AudioContext || window.webkitAudioContext)();
      const previewSource = this.previewContext.createMediaStreamSource(this.previewMicStream);

      this.analyserNode = this.previewContext.createAnalyser();
      this.analyserNode.fftSize = 1024;

      previewSource.connect(this.analyserNode);

      document.getElementById('visualizerPlaceholder').textContent = 'Mic Live';
      if (this.visualizerAnimationId) cancelAnimationFrame(this.visualizerAnimationId);
      this.drawWaveform();
    } catch (err) {
      console.warn('Could not start live mic preview:', err);
      document.getElementById('visualizerPlaceholder').textContent = 'Mic Disabled';
    }
  }

  /**
   * Stop microphone preview
   */
  stopMicrophoneVisualizerPreview() {
    if (this.visualizerAnimationId) cancelAnimationFrame(this.visualizerAnimationId);

    if (this.previewMicStream) {
      this.previewMicStream.getTracks().forEach(t => t.stop());
      this.previewMicStream = null;
    }

    if (this.previewContext && this.previewContext.state !== 'closed') {
      this.previewContext.close();
      this.previewContext = null;
    }

    this.analyserNode = null;
    document.getElementById('visualizerPlaceholder').textContent = 'Mic Inactive';

    const visualizer = document.getElementById('visualizer');
    if (visualizer) {
      this.startIdleVisualizer();
    }
  }

  /**
   * Update audio filters
   */
  updateFilters() {
    if (!this.audioContext || this.audioContext.state === 'closed') return;

    const highpassSlider = document.getElementById('highpassSlider');
    const lowpassSlider = document.getElementById('lowpassSlider');
    const gainSlider = document.getElementById('gainSlider');

    const hpFreq = parseFloat(highpassSlider.value);
    const lpFreq = parseFloat(lowpassSlider.value);
    const gainVal = parseFloat(gainSlider.value);

    if (this.filterHighpassNode) {
      this.filterHighpassNode.frequency.setValueAtTime(hpFreq, this.audioContext.currentTime);
    }
    if (this.filterLowpassNode) {
      this.filterLowpassNode.frequency.setValueAtTime(lpFreq, this.audioContext.currentTime);
    }
    if (this.filterGainNode) {
      this.filterGainNode.gain.setValueAtTime(gainVal, this.audioContext.currentTime);
    }
  }

  /**
   * Start timer
   */
  startTimer() {
    this.startTime = Date.now() - this.elapsedTime;
    this.timerInterval = setInterval(() => {
      this.elapsedTime = Date.now() - this.startTime;
      const timerDisplay = document.getElementById('timerDisplay');
      if (timerDisplay) {
        timerDisplay.textContent = formatTime(this.elapsedTime);
      }
    }, 100);
  }

  /**
   * Pause timer
   */
  pauseTimer() {
    clearInterval(this.timerInterval);
  }

  /**
   * Stop timer
   */
  stopTimer() {
    clearInterval(this.timerInterval);
    this.elapsedTime = 0;
    const timerDisplay = document.getElementById('timerDisplay');
    if (timerDisplay) {
      timerDisplay.textContent = '00:00:00';
    }
  }

  /**
   * Start recording session
   * @param {Object} options - Recording options
   */
  async startRecording(options) {
    const { format, fps, quality, includeWebcam } = options;

    this.recordedChunks = [];
    this.elapsedTime = 0;
    this.totalPauseDurationUs = 0;
    this.pauseStartUs = 0;
    this.stopMicrophoneVisualizerPreview();

    const isMp4 = format === 'mp4';
    const useWebCodecs = isMp4 && this.useWebCodecsForMp4;

    // Load mp4-muxer if needed
    if (useWebCodecs) {
      const statusText = document.getElementById('statusText');
      if (statusText) statusText.textContent = 'Loading Engine...';
      
      try {
        const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm');
        window.Mp4Muxer = Muxer;
        window.Mp4ArrayBufferTarget = ArrayBufferTarget;
      } catch (cdnErr) {
        showToast('Failed to load H.264 MP4 encoder. Fallback to WebM.', 'error');
        throw new Error('MP4 encoder load failed');
      }
    }

    try {
      // Construct display constraints
      const displayConstraints = {
        video: {
          frameRate: { ideal: fps, max: 60 }
        },
        audio: options.systemAudio ? { echoCancellation: false } : false
      };

      if (quality === '1080p') {
        displayConstraints.video.width = { ideal: 1920 };
        displayConstraints.video.height = { ideal: 1080 };
      } else if (quality === '720p') {
        displayConstraints.video.width = { ideal: 1280 };
        displayConstraints.video.height = { ideal: 720 };
      }

      // Request screen stream
      this.videoStream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);

      // Enable webcam if requested
      if (includeWebcam) {
        try {
          await webcamManager.enableWebcam();
        } catch (err) {
          showToast('Webcam access denied. Recording screen only.', 'warning');
          const webcamToggle = document.getElementById('webcamToggle');
          if (webcamToggle) webcamToggle.checked = false;
        }
      }

      // Request mic stream if selected
      if (options.micEnabled) {
        try {
          if (
            this.previewMicStream &&
            this.previewMicStream.getAudioTracks().length > 0 &&
            this.previewMicStream.getAudioTracks()[0].readyState === 'live'
          ) {
            this.microphoneStream = this.previewMicStream;
          } else {
            this.microphoneStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              }
            });
          }
        } catch (micErr) {
          showToast('Microphone access denied. Recording screen audio only.', 'warning');
          const micToggle = document.getElementById('micToggle');
          if (micToggle) micToggle.checked = false;
        }
      }

      // Route and mix audio tracks
      const systemAudioTracks = this.videoStream.getAudioTracks();
      const hasSystemAudio = systemAudioTracks.length > 0;
      const hasMicAudio = this.microphoneStream && this.microphoneStream.getAudioTracks().length > 0;

      if (hasSystemAudio || hasMicAudio) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.destinationNode = this.audioContext.createMediaStreamDestination();

        if (hasMicAudio) {
          const micSource = this.audioContext.createMediaStreamSource(this.microphoneStream);

          this.filterHighpassNode = this.audioContext.createBiquadFilter();
          this.filterHighpassNode.type = 'highpass';

          this.filterLowpassNode = this.audioContext.createBiquadFilter();
          this.filterLowpassNode.type = 'lowpass';

          this.filterGainNode = this.audioContext.createGain();

          this.updateFilters();

          this.analyserNode = this.audioContext.createAnalyser();
          this.analyserNode.fftSize = 1024;

          micSource.connect(this.filterHighpassNode);
          this.filterHighpassNode.connect(this.filterLowpassNode);
          this.filterLowpassNode.connect(this.filterGainNode);
          this.filterGainNode.connect(this.analyserNode);
          this.analyserNode.connect(this.destinationNode);
        }

        if (hasSystemAudio) {
          const systemAudioSource = this.audioContext.createMediaStreamSource(this.videoStream);
          systemAudioSource.connect(this.destinationNode);
        }

        this.audioTracks = this.destinationNode.stream.getAudioTracks();
      }

      this.recordingState = 'recording';

      if (useWebCodecs) {
        await this._startWebCodecsRecording(format, fps, isMp4);
      } else {
        this._startMediaRecorderRecording(format, isMp4);
      }

      this.startTimer();
      showToast(`Recording session started (${format.toUpperCase()}).`, 'success');

      return true;
    } catch (err) {
      console.error('Recording initiation failure:', err);
      showToast(`Recording failed: ${err.message || err}`, 'error');
      this.resetAppState();
      throw err;
    }
  }

  /**
   * Start recording with WebCodecs pipeline
   */
  async _startWebCodecsRecording(format, fps, isMp4) {
    const videoTrack = this.videoStream.getVideoTracks()[0];
    const videoSettings = videoTrack.getSettings();

    const rawWidth = videoSettings.width || 1280;
    const rawHeight = videoSettings.height || 720;

    const encoderWidth = rawWidth % 2 !== 0 ? rawWidth - 1 : rawWidth;
    const encoderHeight = rawHeight % 2 !== 0 ? rawHeight - 1 : rawHeight;

    let videoBitrate = 4_000_000;
    if (encoderWidth >= 1920) {
      videoBitrate = fps === 60 ? 6_000_000 : 4_000_000;
    } else {
      videoBitrate = fps === 60 ? 3_000_000 : 2_000_000;
    }

    const muxerOptions = {
      target: new window.Mp4ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width: encoderWidth,
        height: encoderHeight
      },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset'
    };

    const hasAudio = this.audioTracks.length > 0;
    let audioSampleRate = 48000;
    let audioChannels = 1;

    if (hasAudio) {
      const audioTrack = this.audioTracks[0];
      audioSampleRate = audioTrack.getSettings().sampleRate || 48000;
      audioChannels = Math.min(2, audioTrack.getSettings().channelCount || 1);

      muxerOptions.audio = {
        codec: 'aac',
        numberOfChannels: audioChannels,
        sampleRate: audioSampleRate
      };
    }

    this.muxer = new window.Mp4Muxer(muxerOptions);

    this.videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        this.muxer.addVideoChunk(chunk, meta);
      },
      error: (e) => {
        console.error('VideoEncoder error:', e);
        showToast(`Video encoding error: ${e.message}`, 'error');
      }
    });

    this.videoEncoder.configure({
      codec: 'avc1.42002a',
      width: encoderWidth,
      height: encoderHeight,
      bitrate: videoBitrate,
      framerate: fps,
      latencyMode: 'realtime'
    });

    if (hasAudio) {
      this.audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
          const adjustedTimestamp = chunk.timestamp - this.totalPauseDurationUs;
          const dataBuffer = new ArrayBuffer(chunk.byteLength);
          chunk.copyTo(dataBuffer);

          const adjustedChunk = new EncodedAudioChunk({
            type: chunk.type,
            timestamp: adjustedTimestamp,
            duration: chunk.duration,
            data: dataBuffer
          });

          this.muxer.addAudioChunk(adjustedChunk, meta);
        },
        error: (e) => {
          console.error('AudioEncoder error:', e);
          showToast(`Audio encoding error: ${e.message}`, 'error');
        }
      });

      this.audioEncoder.configure({
        codec: 'mp4a.40.2',
        numberOfChannels: audioChannels,
        sampleRate: audioSampleRate,
        bitrate: 128000
      });
    }

    videoTrack.addEventListener('ended', () => {
      if (this.recordingState === 'recording' || this.recordingState === 'paused') {
        this.stopRecording();
      }
    });

    if (this.analyserNode) {
      document.getElementById('visualizerPlaceholder').textContent = 'Mic Processing';
      if (this.visualizerAnimationId) cancelAnimationFrame(this.visualizerAnimationId);
      this.drawWaveform();
    } else {
      document.getElementById('visualizerPlaceholder').textContent = 'No Audio Source';
    }

    this._runVideoEncoderLoop(videoTrack);
    if (hasAudio) {
      this._runAudioEncoderLoop(this.audioTracks[0]);
    }
  }

  /**
   * Start recording with MediaRecorder pipeline
   */
  _startMediaRecorderRecording(format, isMp4) {
    const combinedStreamTracks = [
      this.videoStream.getVideoTracks()[0],
      ...this.audioTracks
    ];

    const combinedStream = new MediaStream(combinedStreamTracks);

    let options = {};
    if (isMp4 && this.supportsNativeMp4) {
      options = { mimeType: 'video/mp4;codecs=avc1' };
    } else {
      options = { mimeType: 'video/webm;codecs=vp9,opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm;codecs=vp8,opus' };
      }
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm' };
      }
    }

    this.mediaRecorder = new MediaRecorder(combinedStream, options);

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.recordedChunks.push(e.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      const fileType = isMp4 ? 'video/mp4' : 'video/webm';
      const ext = isMp4 ? 'mp4' : 'webm';
      const blob = new Blob(this.recordedChunks, { type: fileType });
      this._handleRecordingSaved(blob, ext);
    };

    this.videoStream.getVideoTracks()[0].addEventListener('ended', () => {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.stopRecording();
      }
    });

    this.mediaRecorder.start(1000);

    if (this.analyserNode) {
      document.getElementById('visualizerPlaceholder').textContent = 'Mic Processing';
      if (this.visualizerAnimationId) cancelAnimationFrame(this.visualizerAnimationId);
      this.drawWaveform();
    } else {
      document.getElementById('visualizerPlaceholder').textContent = 'No Audio Source';
    }
  }

  /**
   * Video encoder loop for WebCodecs
   */
  async _runVideoEncoderLoop(videoTrack) {
    const trackProcessor = new MediaStreamTrackProcessor({ track: videoTrack });
    this.videoReader = trackProcessor.readable.getReader();

    let frameCount = 0;

    try {
      while (this.recordingState === 'recording' || this.recordingState === 'paused') {
        const { done, value: frame } = await this.videoReader.read();
        if (done) break;

        if (this.recordingState === 'paused') {
          frame.close();
          continue;
        }

        frameCount++;
        const forceKeyframe = frameCount % 120 === 0;

        const adjustedTimestamp = frame.timestamp - this.totalPauseDurationUs;
        const adjustedFrame = new VideoFrame(frame, {
          timestamp: adjustedTimestamp
        });

        this.videoEncoder.encode(adjustedFrame, { keyFrame: forceKeyframe });

        adjustedFrame.close();
        frame.close();
      }
    } catch (err) {
      console.error('Video processing thread crashed:', err);
    } finally {
      try {
        this.videoReader.releaseLock();
      } catch (e) {}
    }
  }

  /**
   * Audio encoder loop for WebCodecs
   */
  async _runAudioEncoderLoop(audioTrack) {
    const trackProcessor = new MediaStreamTrackProcessor({ track: audioTrack });
    this.audioReader = trackProcessor.readable.getReader();

    try {
      while (this.recordingState === 'recording' || this.recordingState === 'paused') {
        const { done, value: audioData } = await this.audioReader.read();
        if (done) break;

        if (this.recordingState === 'paused') {
          audioData.close();
          continue;
        }

        this.audioEncoder.encode(audioData);
        audioData.close();
      }
    } catch (err) {
      console.error('Audio processing thread crashed:', err);
    } finally {
      try {
        this.audioReader.releaseLock();
      } catch (e) {}
    }
  }

  /**
   * Toggle pause/resume
   */
  togglePause() {
    const formatSelect = document.getElementById('formatSelect');
    const format = formatSelect ? formatSelect.value : 'webm';
    const useWebCodecs = format === 'mp4' && this.useWebCodecsForMp4;

    if (useWebCodecs) {
      if (this.recordingState === 'recording') {
        this.recordingState = 'paused';
        this.pauseTimer();
        this._setUIPausedState(true);
        this.pauseStartUs = performance.now() * 1000;
        showToast('Recording paused.', 'info');
      } else if (this.recordingState === 'paused') {
        this.recordingState = 'recording';

        if (this.pauseStartUs > 0) {
          this.totalPauseDurationUs += performance.now() * 1000 - this.pauseStartUs;
          this.pauseStartUs = 0;
        }

        this.startTimer();
        this._setUIPausedState(false);
        showToast('Recording resumed.', 'success');
      }
    } else {
      if (!this.mediaRecorder) return;

      if (this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.pause();
        this.pauseTimer();
        this._setUIPausedState(true);
        showToast('Recording paused.', 'info');
      } else if (this.mediaRecorder.state === 'paused') {
        this.mediaRecorder.resume();
        this.startTimer();
        this._setUIPausedState(false);
        showToast('Recording resumed.', 'success');
      }
    }
  }

  /**
   * Stop recording
   */
  async stopRecording() {
    const formatSelect = document.getElementById('formatSelect');
    const format = formatSelect ? formatSelect.value : 'webm';
    const useWebCodecs = format === 'mp4' && this.useWebCodecsForMp4;

    if (useWebCodecs) {
      if (this.recordingState === 'inactive') return;

      this.recordingState = 'stopped';
      const statusText = document.getElementById('statusText');
      if (statusText) statusText.textContent = 'Finalizing...';
      showToast('Finalizing MP4 file, please wait...', 'info');

      this.pauseTimer();

      if (this.videoReader) {
        try {
          await this.videoReader.cancel();
        } catch (e) {}
        this.videoReader = null;
      }
      if (this.audioReader) {
        try {
          await this.audioReader.cancel();
        } catch (e) {}
        this.audioReader = null;
      }

      if (this.videoEncoder && this.videoEncoder.state !== 'unconfigured') {
        try {
          await this.videoEncoder.flush();
        } catch (e) {}
      }
      if (this.audioEncoder && this.audioEncoder.state !== 'unconfigured') {
        try {
          await this.audioEncoder.flush();
        } catch (e) {}
      }

      let mp4Blob = null;
      if (this.muxer) {
        try {
          await this.muxer.finalize();
          const buffer = this.muxer.target.buffer;
          mp4Blob = new Blob([buffer], { type: 'video/mp4' });
        } catch (muxErr) {
          console.error('Muxer finalization failure:', muxErr);
          showToast('Error generating MP4 file.', 'error');
        }
        this.muxer = null;
      }

      if (this.videoEncoder) {
        try {
          this.videoEncoder.close();
        } catch (e) {}
        this.videoEncoder = null;
      }
      if (this.audioEncoder) {
        try {
          this.audioEncoder.close();
        } catch (e) {}
        this.audioEncoder = null;
      }

      if (mp4Blob) {
        this._handleRecordingSaved(mp4Blob, 'mp4');
      } else {
        this.resetAppState();
      }
    } else {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return;
      this.mediaRecorder.stop();
      this.pauseTimer();
      showToast('Recording stopped. Saving...', 'info');
    }
  }

  /**
   * Handle recording saved
   */
  _handleRecordingSaved(blob, format) {
    const videoUrl = URL.createObjectURL(blob);
    const previewVideo = document.getElementById('previewVideo');
    const previewModalOverlay = document.getElementById('previewModalOverlay');
    const filenameInput = document.getElementById('filenameInput');

    if (previewVideo) previewVideo.src = videoUrl;
    if (previewModalOverlay) previewModalOverlay.classList.add('active');

    const timeStamp = new Date().toISOString().slice(0, 10);
    if (filenameInput) filenameInput.value = `pablo-recording-${timeStamp}`;

    const extElement = document.getElementById('downloadExtension');
    if (extElement) extElement.textContent = `.${format}`;

    this.resetAppState();
  }

  /**
   * Reset app state
   */
  resetAppState() {
    this.stopTimer();
    this.recordingState = 'inactive';

    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
      this.videoStream = null;
    }

    const micToggle = document.getElementById('micToggle');
    if (this.microphoneStream) {
      if (!micToggle || !micToggle.checked) {
        this.microphoneStream.getTracks().forEach(track => track.stop());
        this.microphoneStream = null;
        this.previewMicStream = null;
      } else {
        this.previewMicStream = this.microphoneStream;
        this.microphoneStream = null;
      }
    }

    // Disable webcam
    webcamManager.disableWebcam();

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.analyserNode = null;
    this.audioTracks = [];

    this._setUIRecordingState(false);
    this.setupMicrophoneVisualizerPreview();
  }

  /**
   * Set UI recording state
   */
  _setUIRecordingState(isRecording) {
    const btnStart = document.getElementById('btnStart');
    const recordingControls = document.getElementById('recordingControls');
    const statusText = document.getElementById('statusText');
    const statusIndicator = document.getElementById('statusIndicator');
    const formatSelect = document.getElementById('formatSelect');
    const qualitySelect = document.getElementById('qualitySelect');
    const fpsSelect = document.getElementById('fpsSelect');
    const micToggle = document.getElementById('micToggle');
    const systemAudioToggle = document.getElementById('systemAudioToggle');

    if (isRecording) {
      if (btnStart) btnStart.style.display = 'none';
      if (recordingControls) recordingControls.style.display = 'grid';
      if (statusText) statusText.textContent = 'Recording';
      if (statusIndicator) statusIndicator.className = 'status-indicator recording';

      if (formatSelect) formatSelect.disabled = true;
      if (qualitySelect) qualitySelect.disabled = true;
      if (fpsSelect) fpsSelect.disabled = true;
      if (micToggle) micToggle.disabled = true;
      if (systemAudioToggle) systemAudioToggle.disabled = true;
    } else {
      if (btnStart) btnStart.style.display = 'flex';
      if (recordingControls) recordingControls.style.display = 'none';

      this._setUIPausedState(false);

      if (statusText) statusText.textContent = 'Ready';
      if (statusIndicator) statusIndicator.className = 'status-indicator';

      if (formatSelect) formatSelect.disabled = false;
      if (qualitySelect) qualitySelect.disabled = false;
      if (fpsSelect) fpsSelect.disabled = false;
      if (micToggle) micToggle.disabled = false;
      if (systemAudioToggle) systemAudioToggle.disabled = false;
    }
  }

  /**
   * Set UI paused state
   */
  _setUIPausedState(isPaused) {
    const btnPause = document.getElementById('btnPause');
    const statusText = document.getElementById('statusText');
    const statusIndicator = document.getElementById('statusIndicator');

    if (isPaused) {
      if (btnPause) {
        btnPause.className = 'btn btn-primary';
        btnPause.style.background = 'var(--success)';
        btnPause.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
          <span>Resume</span>
        `;
      }
      if (statusText) statusText.textContent = 'Paused';
      if (statusIndicator) statusIndicator.className = 'status-indicator paused';
    } else {
      if (btnPause) {
        btnPause.className = 'btn btn-warning';
        btnPause.style.background = '';
        btnPause.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          <span>Pause</span>
        `;
      }
      if (statusText) statusText.textContent = 'Recording';
      if (statusIndicator) statusIndicator.className = 'status-indicator recording';
    }
  }
}

// Export singleton instance
export const screenRecorder = new ScreenRecorder();
