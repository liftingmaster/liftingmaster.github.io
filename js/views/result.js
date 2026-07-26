export function register(app) {
  app.registerScreen('result', render);
}

function render(root, app) {
  const card = document.createElement('div');
  card.className = 'card';
  card.textContent = 'result（これから つくる）';
  root.appendChild(card);
}
