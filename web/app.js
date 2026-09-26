const designLink = document.createElement('link');
designLink.rel = 'stylesheet';
designLink.href = 'redesign.css';
document.head.appendChild(designLink);

const savedTheme = localStorage.getItem('balls49-theme');
if (savedTheme === 'dark') document.body.classList.add('dark-theme');

const themeToggle = document.createElement('button');
themeToggle.className = 'theme-toggle';
themeToggle.type = 'button';
themeToggle.textContent = document.body.classList.contains('dark-theme') ? 'Light theme' : 'Dark theme';
themeToggle.addEventListener('click', () => {
  const dark = document.body.classList.toggle('dark-theme');
  localStorage.setItem('balls49-theme', dark ? 'dark' : 'light');
  themeToggle.textContent = dark ? 'Light theme' : 'Dark theme';
});
document.querySelector('.site-header,.app-nav')?.appendChild(themeToggle);

// Keep the workspace navigation focused on the pages used for operations.
document.querySelectorAll('.app-nav-links a[href="calibration.html"], .app-nav-links a[href="predictions.html"]').forEach((link) => link.remove());

// Notifications are managed outside this frontend preview, so keep Settings focused on account access.
document.querySelectorAll('.field').forEach((field) => {
  if (field.querySelector('label')?.textContent.trim().toLowerCase() === 'telegram chat id') field.remove();
});

const menuButton = document.querySelector('.menu-button');
const nav = document.querySelector('.desktop-nav');

menuButton?.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
});

nav?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    nav.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
  });
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) observer.unobserve(entry.target);
    entry.target.classList.toggle('visible', entry.isIntersecting);
  });
}, { threshold: 0.14 });

document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
