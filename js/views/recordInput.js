export function register(app) {
  app.registerScreen('recordInput', render);
}

function render(root, app) {
  const card = document.createElement('div');
  card.className = 'card';
  card.textContent = 'recordInput（これから つくる）';
  root.appendChild(card);
}
