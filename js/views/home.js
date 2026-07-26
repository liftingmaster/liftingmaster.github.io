export function register(app) {
  app.registerScreen('home', render);
}

function render(root, app) {
  const card = document.createElement('div');
  card.className = 'card';
  card.textContent = 'home（これから つくる）';
  root.appendChild(card);
}
