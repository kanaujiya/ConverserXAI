'use client';

import React, { useEffect, useRef } from 'react';

interface AudioWaveProps {
  isRecording: boolean;
  stream: MediaStream | null;
}

export function AudioWave({ isRecording, stream }: AudioWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  // Keep the AudioContext in a ref so cleanup always finds it
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isRecording || !stream || !canvas) {
      // Teardown
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      sourceRef.current?.disconnect();
      sourceRef.current = null;
      analyserRef.current = null;
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      return;
    }

    // Guard: reuse or create AudioContext (browsers allow max ~6 simultaneously)
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const ctx = audioContextRef.current;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    analyserRef.current = analyser;
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const draw2d = canvas.getContext('2d');

    const draw = () => {
      if (!draw2d || !analyserRef.current) return;

      animationRef.current = requestAnimationFrame(draw);
      analyserRef.current.getByteFrequencyData(dataArray as any);

      const W = canvas.width;
      const H = canvas.height;
      draw2d.clearRect(0, 0, W, H);

      const barWidth = Math.max(1, (W / bufferLength) * 2.5);
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barH = (dataArray[i] / 255) * H;

        const gradient = draw2d.createLinearGradient(0, H, 0, H - barH);
        gradient.addColorStop(0, '#0d9488');
        gradient.addColorStop(1, '#14b8a6');

        draw2d.fillStyle = gradient;
        draw2d.beginPath();
        draw2d.roundRect(x, H - barH, barWidth, barH, 2);
        draw2d.fill();

        x += barWidth + 1;
        if (x > W) break;
      }
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      source.disconnect();
      sourceRef.current = null;
      analyserRef.current = null;
      // Close context to free resources — a new one is created on next mount
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, [isRecording, stream]);

  return (
    <div
      className={`w-full flex justify-center items-center transition-all duration-300 overflow-hidden ${
        isRecording ? 'opacity-100 max-h-12' : 'opacity-0 max-h-0'
      }`}
    >
      <canvas
        ref={canvasRef}
        width={220}
        height={36}
        className="rounded"
      />
    </div>
  );
}
