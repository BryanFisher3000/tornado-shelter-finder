(function () {
  var q = document.getElementById('sas-county-q');
  if (!q) return;
  var cards = document.querySelectorAll('#sas-county .sas-county-card');
  var empty = document.querySelector('#sas-county .sas-county-empty');
  q.addEventListener('input', function () {
    var t = q.value.trim().toLowerCase().replace(/\s+county$/, '');
    var shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var ok = !t || cards[i].getAttribute('data-name').indexOf(t) !== -1;
      cards[i].hidden = !ok;
      if (ok) shown++;
    }
    empty.hidden = shown > 0;
  });
})();
