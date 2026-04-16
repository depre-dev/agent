function setYear() {
  const year = document.getElementById("site-year");
  if (year) year.textContent = String(new Date().getFullYear());
}

function markCurrentNav() {
  const current = document.body.dataset.nav ?? "";
  if (!current) return;
  document.querySelectorAll("[data-nav-link]").forEach((link) => {
    if (link.getAttribute("data-nav-link") === current) {
      link.setAttribute("aria-current", "page");
    }
  });
}

setYear();
markCurrentNav();
