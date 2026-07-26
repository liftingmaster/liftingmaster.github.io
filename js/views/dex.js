export function register(app) {
  app.registerScreen('dex', render);
}

function render(root, app) {
  const card = document.createElement('div');
  card.className = 'card';
  card.textContent = 'dex（これから つくる）';
  root.appendChild(card);
}
