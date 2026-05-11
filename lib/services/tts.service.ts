export class TTSService {
  private static queue: string[] = [];
  private static isSpeaking: boolean = false;
  private static synth: SpeechSynthesis | null = null;
  private static currentUtterance: SpeechSynthesisUtterance | null = null;
  private static voice: SpeechSynthesisVoice | null = null;
  private static onStateChange: ((isSpeaking: boolean) => void) | null = null;

  static init() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      this.synth = window.speechSynthesis;
      this.loadVoice();
      this.synth.onvoiceschanged = () => this.loadVoice();
    }
  }

  static setOnStateChange(cb: (isSpeaking: boolean) => void) {
    this.onStateChange = cb;
  }

  private static loadVoice() {
    if (!this.synth) return;
    const voices = this.synth.getVoices();
    this.voice = voices.find((v) => v.lang.startsWith('en') && v.name.includes('Female')) 
               || voices.find((v) => v.lang.startsWith('en')) 
               || null;
  }

  static speak(text: string) {
    if (!text.trim()) return;
    this.queue.push(text);
    this.processQueue();
  }

  private static processQueue() {
    if (this.isSpeaking || this.queue.length === 0 || !this.synth) return;

    const text = this.queue.shift();
    if (!text) return;

    this.isSpeaking = true;
    if (this.onStateChange) this.onStateChange(true);
    
    this.currentUtterance = new SpeechSynthesisUtterance(text);
    
    if (this.voice) {
      this.currentUtterance.voice = this.voice;
    }
    
    this.currentUtterance.rate = 1.05;
    
    this.currentUtterance.onend = () => {
      this.isSpeaking = false;
      this.currentUtterance = null;
      if (this.queue.length === 0 && this.onStateChange) {
        this.onStateChange(false);
      }
      this.processQueue();
    };
    
    this.currentUtterance.onerror = (e) => {
      console.error('TTS Error:', e);
      this.isSpeaking = false;
      this.currentUtterance = null;
      if (this.queue.length === 0 && this.onStateChange) {
        this.onStateChange(false);
      }
      this.processQueue();
    };

    this.synth.speak(this.currentUtterance);
  }

  static stop() {
    this.queue = [];
    if (this.synth) {
      this.synth.cancel();
    }
    this.isSpeaking = false;
    this.currentUtterance = null;
    if (this.onStateChange) this.onStateChange(false);
  }
}
