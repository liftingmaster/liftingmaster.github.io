export function register(app) {
  app.registerScreen('settings', render);
}

function render(root, app) {
  const card = document.createElement('div');
  card.className = 'card';
  card.textContent = 'settings（これから つくる）';
  root.appendChild(card);
}
