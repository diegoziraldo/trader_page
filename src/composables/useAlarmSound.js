import { ref } from 'vue'

/**
 * Sistema de sonido de alarma continuo, portado del script original.
 * Requiere una interacción del usuario en la página (click) antes de poder
 * sonar — restricción estándar de los navegadores para audio autoplay.
 */
export function useAlarmSound() {
  let audioCtx = null
  let intervalId = null
  const isRinging = ref(false)

  function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
  }

  window.addEventListener('click', initAudio, { once: true })

  function playBeep() {
    if (!audioCtx) return
    try {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, audioCtx.currentTime)
      gain.gain.setValueAtTime(0.5, audioCtx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35)
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start()
      osc.stop(audioCtx.currentTime + 0.35)
    } catch (e) {
      console.error('Error reproduciendo audio:', e)
    }
  }

  function start() {
    initAudio()
    isRinging.value = true
    if (intervalId) return
    playBeep()
    setTimeout(playBeep, 150)
    intervalId = setInterval(() => {
      playBeep()
      setTimeout(playBeep, 150)
    }, 800)
  }

  function stop() {
    isRinging.value = false
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  return { isRinging, start, stop }
}