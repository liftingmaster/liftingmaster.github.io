export function register(app) {
  app.registerScreen('dexDetail', render);
}

function render(root, app) {
  const card = document.createElement('div');
  card.className = 'card';
  card.textContent = 'dexDetail（これから つくる）';
  root.appendChild(card);
}
