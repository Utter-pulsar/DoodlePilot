// A tiny WebAudio chime so alarms make a real sound — no audio file needed.
let ctx: AudioContext | null = null

export function playAlarm(): void {
  try {
    ctx = ctx ?? new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const start = ctx.currentTime
    const notes = [880, 660, 880, 1040] // little 4-note chime
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      const t = start + i * 0.18
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17)
      osc.connect(gain).connect(ctx!.destination)
      osc.start(t)
      osc.stop(t + 0.2)
    })
  } catch {
    /* audio unavailable — banner + OS notification still fire */
  }
}
