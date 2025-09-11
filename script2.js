document.addEventListener('DOMContentLoaded', () => {
  // Convert button function
  window.convertCurrency = function () {
    const from = document.getElementById('currency').value.trim().split(" ")[0]; 
    const to = document.getElementById('to').value.trim().split(" ")[0];
    const amt = parseFloat(document.getElementById('amount').value || '0');

    if (!from || !to || isNaN(amt) || amt <= 0) {
      alert("Please enter valid details!");
      return;
    }

    const rate = demoRate(from, to);
    const result = (amt * rate).toFixed(2);

    document.getElementById('final').value = `${to} ${result}`;
  };

  // Demo exchange rates
  function demoRate(from, to) {
    const map = {
      'USDINR': 83.2, 'INRUSD': 0.012,
      'USDEUR': 0.92, 'EURUSD': 1.09,
      'USDGBP': 0.78, 'GBPUSD': 1.28,
      'INREUR': 0.011, 'EURINR': 90.1,
      'INRGBP': 0.0096, 'GBPINR': 104.0,
      'EURGBP': 0.86, 'GBPEUR': 1.16,
      'JPYUSD': 0.0069, 'USDJPY': 145.0
    };
    return map[(from + to)] ?? 1.0;
  }

  // Send button function
  window.sAmount = function () {
    const finalAmount = document.getElementById('final').value;
    if (!finalAmount) {
      alert("Please convert the currency first!");
      return;
    }
    // Redirect with query parameter
    window.location.href = `send.html?amount=${encodeURIComponent(finalAmount)}`;
  };
});
