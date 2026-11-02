const commands = [
  { id: '/status', label: 'Show harness status' },
  { id: '/plan', label: 'Open plan.md' },
  { id: '/checkpoint', label: 'Show latest checkpoint' },
  { id: '/diff', label: 'Show proposed patch' },
  { id: '/accept', label: 'Accept current patch' },
  { id: '/reject', label: 'Reject and rollback' },
  { id: '/steer', label: 'Steer main agent' },
  { id: '/create-skill', label: 'Create skill' },
  { id: '/create-tool', label: 'Create tool' },
];

const palette = document.getElementById('palette');
const paletteInput = document.getElementById('palette-input');
const paletteList = document.getElementById('palette-list');

function openPalette() {
  palette.style.display = 'block';
  paletteInput.value = '';
  renderPalette('');
  paletteInput.focus();
}
function closePalette() { palette.style.display = 'none'; }

function renderPalette(q) {
  const filtered = commands.filter(c => c.id.includes(q) || c.label.toLowerCase().includes(q.toLowerCase()));
  paletteList.innerHTML = filtered.map(c => `<div class="item" data-cmd="${c.id}">${c.id} — ${c.label}</div>`).join('');
}

paletteInput.addEventListener('input', () => renderPalette(paletteInput.value));
paletteList.addEventListener('click', e => {
  const item = e.target.closest('.item');
  if (!item) return;
  toast('Command: ' + item.dataset.cmd);
  closePalette();
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey && e.shiftKey && e.key === 'P') || (e.key === '/' && document.activeElement.tagName !== 'INPUT')) {
    e.preventDefault();
    openPalette();
    if (e.key === '/') { paletteInput.value = '/'; renderPalette('/'); }
  }
  if (e.key === 'Escape') closePalette();
});

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function addProblem(text) {
  const div = document.createElement('div');
  div.textContent = text;
  document.getElementById('problem-list').appendChild(div);
}
function addCheckpoint(text) {
  const div = document.createElement('div');
  div.textContent = text;
  document.getElementById('checkpoint-list').appendChild(div);
}

addProblem('drift: none');
addCheckpoint('scaffold — completed');
document.getElementById('sb-step').textContent = 'step: scaffold';

document.getElementById('voice-toggle').onclick = function () {
  this.textContent = this.textContent.includes('Off') ? 'Voice On' : 'Voice Off';
  document.getElementById('sb-voice').textContent = this.textContent;
  toast(this.textContent);
};
document.getElementById('mute').onclick = function () {
  this.textContent = this.textContent === 'Mute' ? 'Unmute' : 'Mute';
  toast('Assistant ' + this.textContent);
};

toast('OMNI-CODE Ultra ready');
