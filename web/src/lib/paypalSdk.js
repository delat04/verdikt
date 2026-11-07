// PayPal's JS SDK, loaded once for holds (intent=authorize): the fund dialog and the spending limit share it
let loading = null

export function loadPayPal(currency = 'USD') {
  if (window.paypal) return Promise.resolve(window.paypal)
  const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID
  if (!clientId) return Promise.reject(new Error('VITE_PAYPAL_CLIENT_ID is not set'))
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&intent=authorize&currency=${currency}&components=buttons,messages&enable-funding=paylater`
    s.onload = () => resolve(window.paypal)
    s.onerror = () => { loading = null; reject(new Error('Could not load PayPal')) }
    document.head.appendChild(s)
  })
  return loading
}
