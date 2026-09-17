/* FiiViu experience meeting-point registry.
 * Keep real provider-supplied locations here; empty entries are intentional.
 * The checkout/booking bridge reads item.meetingPoint from this registry.
 */
(function () {
  var meetingPoints = {
    "old-town-walk": null,
    "bike-bucharest": null,
    "therme-vip": null,
    "night-out": null,
    "kart-grand-prix": null,
    "limo-night": null
  };

  function apply() {
    try {
      if (typeof categoriesData === "undefined") return;
      Object.keys(categoriesData).forEach(function (categoryKey) {
        var category = categoriesData[categoryKey];
        if (!category || !Array.isArray(category.items)) return;
        category.items.forEach(function (item) {
          if (!item || !item.id || !Object.prototype.hasOwnProperty.call(meetingPoints, item.id)) return;
          if (meetingPoints[item.id]) item.meetingPoint = meetingPoints[item.id];
        });
      });
    } catch (_) {}
  }

  window.__fiiviuMeetingPoints = meetingPoints;
  apply();
  document.addEventListener("DOMContentLoaded", apply);
  setInterval(apply, 1000);
})();
