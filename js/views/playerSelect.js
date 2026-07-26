export function register(app) {
  app.registerScreen('playerSelect', render);
}

function render(root, app) {
  const card = document.createElement('div');
  card.className = 'card';
  card.textContent = 'playerSelect（これから つくる）';
  root.appendChild(card);
}
