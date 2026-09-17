/* FiiViu demo experience meeting-point registry.
 * These values mirror the current D1 demo catalog so the checkout bridge
 * can expose the same details to the booking confirmation flow.
 */
(function () {
  var meetingPoints = {
    "old-town-walk": {
      providerName: "FiiViu City Guides",
      name: "Universitate – National Theatre",
      address: "Piața Universității 2",
      city: "București",
      country: "Romania",
      instructions: "Please arrive 15 minutes before the start. Look for the FiiViu guide with a FiiViu sign near the main entrance.",
      arrivalMinutesBefore: 15,
      latitude: "44.4354",
      longitude: "26.1027"
    },
    "bike-bucharest": {
      providerName: "Urban Pedal Bucharest",
      name: "Piața Unirii Fountain",
      address: "Piața Unirii",
      city: "București",
      country: "Romania",
      instructions: "Please arrive 15 minutes before the start. Your guide will wait beside the main fountain with the bicycles.",
      arrivalMinutesBefore: 15,
      latitude: "44.4279",
      longitude: "26.1025"
    },
    "therme-vip": {
      providerName: "FiiViu Travel Experiences",
      name: "Therme Bucharest – Main Entrance",
      address: "Calea București 1K",
      city: "Balotești",
      country: "Romania",
      instructions: "Please arrive 20 minutes before the scheduled start. Meet the FiiViu representative at the main entrance.",
      arrivalMinutesBefore: 20,
      latitude: "44.6568",
      longitude: "26.0774"
    },
    "night-out": {
      providerName: "Bucharest After Dark",
      name: "Manuc’s Inn – Main Courtyard",
      address: "Strada Franceză 62",
      city: "București",
      country: "Romania",
      instructions: "Please arrive 15 minutes before the start. Meet your guide in the main courtyard near the entrance.",
      arrivalMinutesBefore: 15,
      latitude: "44.4305",
      longitude: "26.1014"
    },
    "kart-grand-prix": {
      providerName: "Bucharest Karting Club",
      name: "Karting Arena – Reception",
      address: "Șoseaua Pipera 4",
      city: "București",
      country: "Romania",
      instructions: "Please arrive 20 minutes before the start for registration and safety briefing. Bring your booking ID.",
      arrivalMinutesBefore: 20,
      latitude: "44.4900",
      longitude: "26.1200"
    },
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
