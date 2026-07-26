export function register(app) {
  app.registerScreen('logbook', render);
}

function render(root, app) {
  const card = document.createElement('div');
  card.className = 'card';
  card.textContent = 'logbook（これから つくる）';
  root.appendChild(card);
}
