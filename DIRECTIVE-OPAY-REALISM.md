# DIRECTIVE: OPay Receipt UI — Realism Improvement

## Context
I'm building a UI reference implementation of an OPay transaction receipt screen for design study. The goal is pixel-level accuracy to the real OPay app's transaction details screen.

## Current State
A functional HTML prototype exists with the correct layout structure:
- iOS status bar with Dynamic Island
- Transaction Details header with back chevron + person icon
- White summary card: OPay circle icon, sender name, Naira amount, green checkmark "Successful"
- Transaction Details card: Credited to / Sender Details (OPay | masked phone) / Transaction No. with copy icon / Transaction Date
- More Actions card: Transfer Back + View Records
- Green Share Receipt button + home indicator

The layout is structurally correct (matches real OPay screenshots) but needs refinement to feel truly native.

## Your Task
Improve the realism of the attached HTML file. Focus on:

1. **Typography** — Match iOS system font rendering. The large Naira amount needs proper kerning and weight. Labels should use iOS system gray (#8e8e93). SF Pro font-family chain.

2. **Spacing** — iOS has very specific vertical rhythm. Check padding, margins between elements, and row heights against actual iOS Settings/transaction screens.

3. **Colors** — Verify the green matches OPay's exact brand green. Card white vs iOS system background exact values. Divider color and thickness.

4. **Icons** — The back chevron, copy icon, and OPay circle emblem need to look native iOS. Currently using CSS/HTML approximations — improve fidelity.

5. **Status bar** — Should look exactly like a real iPhone screenshot. Signal bars, WiFi indicator, battery icon.

6. **Card styling** — iOS card border-radius, subtle shadows if any, edge-to-edge vs inset margins.

7. **Any other micro-details** that distinguish a real app screenshot from a web approximation.

## Rules
- Keep it a single self-contained HTML file
- Maintain the editor panel (left side) + phone preview (right side) layout
- All fields must remain editable
- The "Random" and "Screenshot" buttons must still work
- Do NOT change the overall structure — refine what exists

## File
The HTML file is included below. Return the improved version.

---

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=390, initial-scale=1.0">
<title>OPay Receipt</title>
<style>
  :root {
    --green: #00A85A;
    --green-dark: #008040;
    --ios-bg: #f2f2f7;
    --card-bg: #f5f5f5;
    --text: #000000;
    --text-secondary: #555555;
    --text-light: #8e8e93;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', sans-serif;
    background: #1a1a2e;
    min-height: 100vh;
    display: flex;
    gap: 24px;
    padding: 24px;
    justify-content: center;
    align-items: flex-start;
  }
  /* Editor */
  .editor {
    background: #16213e;
    border-radius: 14px;
    padding: 22px;
    width: 340px;
    color: #ccc;
    position: sticky;
    top: 24px;
    font-family: -apple-system, sans-serif;
  }
  .editor h2 { font-size: 15px; margin-bottom: 14px; color: #fff; font-weight: 700; }
  .editor label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin: 9px 0 2px; }
  .editor input { width: 100%; padding: 7px 10px; border: 1px solid #2a2a4a; border-radius: 6px; background: #0f3460; color: #fff; font-size: 12px; font-family: inherit; }
  .editor input:focus { outline: none; border-color: var(--green); }
  .editor .btn-row { display: flex; gap: 7px; margin-top: 16px; }
  .editor button { flex: 1; padding: 7px; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn-random { background: #0f3460; color: #e0e0e0; }
  .btn-screenshot { background: var(--green); color: #fff; }
  /* Phone screen */
  .screen {
    width: 390px;
    background: var(--ios-bg);
    border-radius: 44px;
    overflow: hidden;
    box-shadow: 0 0 0 4px #1a1a1a, 0 0 0 6px #333, 0 20px 50px rgba(0,0,0,0.4);
  }
  /* Status bar */
  .status-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 32px 0;
    font-size: 15px;
    font-weight: 600;
    color: #000;
    background: var(--ios-bg);
  }
  .status-bar .time { font-weight: 600; }
  .status-bar .icons { display: flex; gap: 4px; align-items: center; }
  /* Dynamic Island notch */
  .notch {
    width: 126px;
    height: 35px;
    background: #000;
    border-radius: 20px;
    margin: 8px auto 0;
  }
  /* Header */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px 6px;
    background: var(--ios-bg);
  }
  .header .back-chevron {
    width: 24px; height: 24px;
    display: flex; align-items: center; justify-content: center;
    color: #007AFF;
    font-size: 22px;
  }
  .header .title {
    font-size: 17px;
    font-weight: 600;
    color: #000;
    letter-spacing: -0.2px;
  }
  .header .person-icon {
    width: 30px; height: 30px;
    border-radius: 50%;
    background: #00A85A;
    display: flex; align-items: center; justify-content: center;
  }
  .header .person-icon svg { width: 18px; height: 18px; }
  /* Summary section */
  .summary {
    background: #fff;
    margin: 8px 14px 0;
    border-radius: 13px;
    padding: 28px 20px 22px;
    text-align: center;
  }
  .opay-circle {
    width: 46px; height: 46px;
    border-radius: 50%;
    border: 3px solid var(--green);
    margin: 0 auto 14px;
    display: flex; align-items: center; justify-content: center;
    position: relative;
  }
  .opay-circle .dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: var(--green-dark);
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
  }
  .sender-line {
    font-size: 14px;
    color: var(--text);
    margin-bottom: 6px;
    font-weight: 400;
    letter-spacing: -0.1px;
  }
  .amount-display {
    font-size: 38px;
    font-weight: 800;
    color: #000;
    letter-spacing: -0.5px;
    margin: 4px 0 8px;
  }
  .success-tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--green);
    font-size: 14px;
    font-weight: 600;
  }
  .success-tag svg { width: 17px; height: 17px; }
  /* Details section */
  .details {
    background: #fff;
    margin: 8px 14px 0;
    border-radius: 13px;
    padding: 4px 0;
  }
  .details-header {
    font-size: 14px;
    font-weight: 700;
    color: #000;
    padding: 14px 18px 10px;
  }
  .detail-item {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 9px 18px;
  }
  .detail-item .label {
    color: var(--text-light);
    font-size: 14px;
    min-width: 120px;
  }
  .detail-item .value {
    color: #000;
    font-size: 14px;
    text-align: right;
    flex: 1;
    font-weight: 400;
  }
  .detail-item .value .sub {
    display: block;
    color: var(--text-secondary);
    font-size: 12px;
    margin-top: 2px;
  }
  .clickable {
    color: #000 !important;
  }
  .clickable .arrow {
    color: #c7c7cc;
    font-size: 16px;
    margin-left: 2px;
  }
  .copy-btn {
    display: inline-block;
    width: 16px; height: 16px;
    vertical-align: -3px;
    margin-left: 4px;
    position: relative;
  }
  .copy-btn::before {
    content: '';
    position: absolute;
    width: 12px; height: 12px;
    border: 2px solid #bbb;
    border-radius: 3px;
    top: 0; left: 0;
  }
  .copy-btn::after {
    content: '';
    position: absolute;
    width: 10px; height: 10px;
    border: 2px solid #bbb;
    border-radius: 3px;
    background: #fff;
    bottom: 0; right: 0;
  }
  .divider {
    height: 1px;
    background: #e5e5ea;
    margin: 0 18px;
  }
  /* Actions */
  .actions {
    background: #fff;
    margin: 8px 14px 0;
    border-radius: 13px;
    padding: 4px 0 12px;
  }
  .actions-header {
    font-size: 14px;
    font-weight: 700;
    color: #000;
    padding: 14px 18px 0;
  }
  .dashed {
    border-top: 1.5px dashed #d1d1d6;
    margin: 10px 18px 0;
  }
  .action-row {
    display: flex;
    gap: 20px;
    padding: 12px 18px 4px;
  }
  .action-item {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--green);
    font-size: 14px;
    font-weight: 500;
  }
  .action-item svg { width: 20px; height: 20px; flex-shrink: 0; }
  /* Share button */
  .share-receipt-btn {
    background: var(--green);
    color: #fff;
    border: none;
    border-radius: 25px;
    padding: 14px;
    font-size: 17px;
    font-weight: 600;
    margin: 16px 14px 20px;
    width: calc(100% - 28px);
    cursor: pointer;
    font-family: inherit;
    letter-spacing: -0.1px;
  }
  /* Home indicator */
  .home-indicator {
    width: 134px;
    height: 5px;
    background: #000;
    border-radius: 3px;
    margin: 0 auto 8px;
    opacity: 0.2;
  }
  /* Toast */
  .toast {
    position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
    background: var(--green); color: #fff; padding: 12px 28px;
    border-radius: 30px; font-weight: 600; font-size: 14px;
    z-index: 999; opacity: 0; transition: opacity 0.3s; pointer-events: none;
    font-family: -apple-system, sans-serif;
  }
  .toast.show { opacity: 1; }
  @media (max-width: 860px) {
    body { flex-direction: column-reverse; align-items: center; padding: 10px; gap: 14px; }
    .editor { width: 100%; max-width: 390px; position: static; }
    .screen { width: 100%; max-width: 390px; border-radius: 30px; }
  }
</style>
</head>
<body>

<div class="editor">
  <h2>Receipt Editor</h2>
  <label>Amount (₦)</label>
  <input type="text" id="amount" value="400,300.00">
  <label>Sender Name</label>
  <input type="text" id="sender" value="NATHANIEL EBOSETALE EHINON">
  <label>Masked Phone</label>
  <input type="text" id="phone" value="903****398" maxlength="12">
  <label>Transaction No.</label>
  <input type="text" id="txnId" value="260625010100817547960727">
  <label>Date</label>
  <input type="text" id="datetime" value="Jun 25th, 2026 12:17:36">
  <div class="btn-row">
    <button class="btn-random" onclick="randomize()">🎲 Random</button>
    <button class="btn-screenshot" onclick="takeScreenshot()">📸 Screenshot</button>
  </div>
</div>

<div class="screen" id="phoneScreen">
  <div class="status-bar">
    <span class="time" id="displayTime">18:42</span>
    <span class="icons">
      <svg width="16" height="12" viewBox="0 0 16 12"><rect x="0.5" y="7" width="2.5" height="4.5" rx="0.8" fill="black"/><rect x="4.5" y="5" width="2.5" height="6.5" rx="0.8" fill="black"/><rect x="8.5" y="3" width="2.5" height="8.5" rx="0.8" fill="black"/><rect x="12.5" y="1" width="2.5" height="10.5" rx="0.8" fill="black"/></svg>
      <span style="font-size:12px;font-weight:500;">WiFi</span>
      <svg width="25" height="12" viewBox="0 0 25 12"><rect x="0" y="0" width="22" height="11.5" rx="2.5" stroke="black" stroke-width="1" fill="none"/><rect x="2" y="2" width="18" height="7.5" rx="1" fill="black"/><text x="23" y="10" font-size="8" fill="black">▸</text></svg>
    </span>
  </div>

  <div class="notch"></div>

  <div class="header">
    <div class="back-chevron">
      <svg width="13" height="20" viewBox="0 0 13 20"><path d="M11 2L3 10l8 8" stroke="#007AFF" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <div class="title">Transaction Details</div>
    <div class="person-icon">
      <svg viewBox="0 0 24 24" fill="white"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" fill="none" stroke="white" stroke-width="2"/></svg>
    </div>
  </div>

  <div class="summary">
    <div class="opay-circle"><div class="dot"></div></div>
    <div class="sender-line" id="displaySender">Transfer from NATHANIEL EBOSETALE EHIN...</div>
    <div class="amount-display" id="displayAmount">₦400,300.00</div>
    <div class="success-tag">
      <svg viewBox="0 0 24 24" fill="none" stroke="#00A85A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      Successful
    </div>
  </div>

  <div class="details">
    <div class="details-header">Transaction Details</div>
    <div class="detail-item">
      <span class="label">Credited to</span>
      <span class="value clickable">Available Balance <span class="arrow">›</span></span>
    </div>
    <div class="divider"></div>
    <div class="detail-item">
      <span class="label">Sender Details</span>
      <span class="value">
        <span id="displaySenderFull">NATHANIEL EBOSETALE EHINON</span>
        <span class="sub">OPay | <span id="displayPhone">903****398</span></span>
      </span>
    </div>
    <div class="divider"></div>
    <div class="detail-item">
      <span class="label">Transaction No.</span>
      <span class="value">
        <span id="displayTxnId">260625010100817547960727</span>
        <span class="copy-btn"></span>
      </span>
    </div>
    <div class="divider"></div>
    <div class="detail-item">
      <span class="label">Transaction Date</span>
      <span class="value" id="displayDatetime">Jun 25th, 2026 12:17:36</span>
    </div>
  </div>

  <div class="actions">
    <div class="actions-header">More Actions</div>
    <div class="dashed"></div>
    <div class="action-row">
      <div class="action-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="#00A85A" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s2 4 4 4 4-4 4-4"/><line x1="12" y1="8" x2="12" y2="14"/></svg>
        Transfer Back
      </div>
      <div class="action-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="#00A85A" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        View Records
      </div>
    </div>
  </div>

  <button class="share-receipt-btn">Share Receipt</button>
  <div class="home-indicator"></div>
</div>

<div class="toast" id="toast">✅ Copied!</div>

<script>
  const fields = ['amount','sender','phone','txnId','datetime'];
  fields.forEach(id => document.getElementById(id).addEventListener('input', updateDisplay));

  function updateDisplay() {
    const raw = document.getElementById('amount').value.replace(/[^0-9.]/g,'');
    const fmt = raw ? parseFloat(raw).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}) : '0.00';
    document.getElementById('displayAmount').textContent = '₦' + fmt;

    const sender = document.getElementById('sender').value || 'NATHANIEL EBOSETALE EHINON';
    document.getElementById('displaySenderFull').textContent = sender;
    document.getElementById('displaySender').textContent = 'Transfer from ' + (sender.length > 30 ? sender.slice(0,27) + '...' : sender + '...');
    document.getElementById('displayPhone').textContent = document.getElementById('phone').value || '903****398';
    document.getElementById('displayTxnId').textContent = document.getElementById('txnId').value || '—';
    document.getElementById('displayDatetime').textContent = document.getElementById('datetime').value || '—';

    const now = new Date();
    document.getElementById('displayTime').textContent = now.toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',hour12:false});
  }

  function randomize() {
    const names = ['NATHANIEL EBOSETALE EHINON','ADEBANJO OLUWASEUN MARY','CHINEDU OBIORA AGU','FATIMA BELLO IBRAHIM','OLAMIDE ADEOLA JOHNSON','EMMANUEL CHUKWUEBUKA OKONKWO'];
    const amt = (Math.random() * 950000 + 30000).toFixed(2);
    document.getElementById('amount').value = parseFloat(amt).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2});
    document.getElementById('sender').value = names[Math.floor(Math.random()*names.length)];
    document.getElementById('phone').value = '90' + Math.floor(Math.random()*10) + '****' + Math.floor(Math.random()*900+100);
    const txn = '26' + String(Math.floor(Date.now()/1000)).slice(2) + String(Math.floor(Math.random()*1000000000000));
    document.getElementById('txnId').value = txn.slice(0,26);
    const d = new Date();
    d.setDate(d.getDate() - Math.floor(Math.random()*20));
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    document.getElementById('datetime').value = months[d.getMonth()] + ' ' + d.getDate() + getOrd(d.getDate()) + ', ' + d.getFullYear() + ' ' + d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
    updateDisplay();
  }
  function getOrd(n) {
    const s = ['th','st','nd','rd'];
    const v = n % 100;
    return s[(v-20)%10] || s[v] || s[0];
  }

  let h2c = false;
  function loadH2C() {
    return new Promise(resolve => {
      if (window.html2canvas) return resolve();
      if (h2c) return resolve();
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload = () => { h2c = true; resolve(); };
      document.head.appendChild(s);
    });
  }
  async function takeScreenshot() {
    const toast = document.getElementById('toast');
    try {
      await loadH2C();
      const canvas = await html2canvas(document.getElementById('phoneScreen'), { scale: 2, backgroundColor: '#f2f2f7' });
      canvas.toBlob(async blob => {
        try {
          await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
          toast.textContent = '✅ Copied to clipboard!';
        } catch {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'opay-receipt-' + Date.now() + '.png';
          a.click();
          toast.textContent = '📥 Downloaded!';
        }
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
      }, 'image/png');
    } catch(e) {
      toast.textContent = '❌ Failed. Manual screenshot instead.';
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
    }
  }
  updateDisplay();
</script>
</body>
</html>
```
