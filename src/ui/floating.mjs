const button = document.querySelector('button');
const bridge = window.glyphOn;
let start;
let moved = false;

button.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  button.setPointerCapture(event.pointerId);
  start = [event.screenX, event.screenY];
  moved = false;
  void bridge.floatingDrag('start');
});

button.addEventListener('pointermove', event => {
  if (!start) return;
  if (moved || Math.hypot(event.screenX - start[0], event.screenY - start[1]) > 4) {
    moved = true;
    void bridge.floatingDrag('move');
  }
});

function release() {
  if (start && moved) void bridge.floatingDrag('end');
  start = undefined;
}

button.addEventListener('pointerup', release);
button.addEventListener('pointercancel', release);
button.addEventListener('click', event => {
  if (!moved || event.detail === 0) void bridge.floatingOpen();
  moved = false;
});
