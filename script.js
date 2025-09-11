document.addEventListener('DOMContentLoaded', () => {
  const ctx = document.getElementById('cashflowChart');
  if (ctx && window.Chart) {
    const labels = ['Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep'];
    new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Inflow',
          data: [120,160,110,140,180,220,200,230,190,210,240,260],
          fill: true,
          tension: 0.35
        },{
          label: 'Outflow',
          data: [90,100,95,120,140,160,150,170,155,165,170,185],
          fill: true,
          tension: 0.35
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true }
        },
        scales: {
          x: { grid: { display:false } },
          y: { grid: { color: 'rgba(255,255,255,0.06)' } }
        }
      }
    });
  }

  // Theme toggle
  const themeToggle = document.getElementById('themeToggle');
  themeToggle?.addEventListener('click', () => {
    document.body.classList.toggle('theme-light');
    document.body.classList.toggle('theme-dark');
  });

  // Collapse sidebar
  const collapseBtn = document.getElementById('collapseBtn');
  const sidebar = document.querySelector('.sidebar');
  collapseBtn?.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    if (sidebar.classList.contains('collapsed')) {
      sidebar.style.width = '84px';
      document.querySelectorAll('.nav-item .label').forEach(el => el.style.display = 'none');
      collapseBtn.textContent = '⇥ Expand';
    } else {
      sidebar.style.width = '';
      document.querySelectorAll('.nav-item .label').forEach(el => el.style.display = '');
      collapseBtn.textContent = '⇤ Collapse';
    }
  });

  // FX converter (demo only)
  const fxForm = document.getElementById('fxForm');
  const fxResult = document.getElementById('fxResult');
  fxForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const from = document.getElementById('fromCur').value;
    const to = document.getElementById('toCur').value;
    const amt = parseFloat(document.getElementById('amount').value || '0');
    const rate = demoRate(from, to);
    fxResult.textContent = `≈ ${to} ${ (amt * rate).toFixed(2) } @ ${rate} (demo)`;
  });

  function demoRate(from, to){
    const map = {
      'INRUSD': 0.012, 'USDINR': 83.2,
      'INREUR': 0.011, 'EURINR': 90.1,
      'INRGBP': 0.0096, 'GBPINR': 104.0,
      'USDEUR': 0.92, 'EURUSD': 1.09,
      'USDGBP': 0.78, 'GBPUSD': 1.28
    };
    return map[(from+to)] ?? 1.0;
  }
});
