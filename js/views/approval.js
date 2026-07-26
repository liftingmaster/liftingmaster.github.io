export function register(app) {
  app.registerScreen('approval', render);
}

function render(root, app) {
  const card = document.createElement('div');
  card.className = 'card';
  card.textContent = 'approval（これから つくる）';
  root.appendChild(card);
}
