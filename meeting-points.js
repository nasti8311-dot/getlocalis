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

  function detectMeetingPoint(data) {
    var text = String(data.experienceName || data.tourName || "").toLowerCase();
    if (/old town|story walk|universitate|national theatre/.test(text)) return meetingPoints["old-town-walk"];
    if (/bike|cycling|pedal|fahrrad/.test(text)) return meetingPoints["bike-bucharest"];
    if (/therme|spa|wellness|vip/.test(text)) return meetingPoints["therme-vip"];
    if (/night out|nightlife|club|after dark/.test(text)) return meetingPoints["night-out"];
    if (/kart|grand prix/.test(text)) return meetingPoints["kart-grand-prix"];
    return null;
  }

  function enrichBookingRequest(data) {
    var meeting = detectMeetingPoint(data);
    if (meeting) {
      window.__fiiviuMeetingPoint = meeting;
      data.providerName = data.providerName || meeting.providerName;
      data.meetingPointName = data.meetingPointName || meeting.name;
      data.meetingAddress = data.meetingAddress || meeting.address;
      data.meetingCity = data.meetingCity || meeting.city;
      data.meetingCountry = data.meetingCountry || meeting.country;
      data.meetingInstructions = data.meetingInstructions || meeting.instructions;
      if (data.arrivalMinutesBefore === undefined || data.arrivalMinutesBefore === null || data.arrivalMinutesBefore === "") data.arrivalMinutesBefore = meeting.arrivalMinutesBefore;
      data.meetingLatitude = data.meetingLatitude || meeting.latitude;
      data.meetingLongitude = data.meetingLongitude || meeting.longitude;
    }

    if (!data.bookingTime) {
      var source = String(data.experienceName || data.tourName || "");
      var timeMatch = source.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/);
      if (timeMatch) data.bookingTime = timeMatch[0];
    }
    return data;
  }

  window.__fiiviuMeetingPoints = meetingPoints;

  /*
   * The booking page is served with a server-side checkout bridge. Enriching
   * the request here makes the bridge independent of whether the catalogue
   * keeps the currently selected meeting point in a singular global variable.
   */
  try {
    var nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        var url = typeof input === "string" ? input : (input && input.url) || "";
        if (url.indexOf("/api/create-payment-intent") !== -1 && init && typeof init.body === "string") {
          var data = JSON.parse(init.body);
          init.body = JSON.stringify(enrichBookingRequest(data));
        }
      } catch (_) {}
      return nativeFetch(input, init);
    };
  } catch (_) {}

  apply();
  document.addEventListener("DOMContentLoaded", apply);
  setInterval(apply, 1000);
})();
