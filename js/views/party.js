export function register(app) {
  app.registerScreen('party', render);
}

function render(root, app) {
  const card = document.createElement('div');
  card.className = 'card';
  card.textContent = 'party（これから つくる）';
  root.appendChild(card);
}
