const form = document.getElementById('signupForm');
const errorMsg = document.getElementById('errorMsg');
const popup = document.getElementById('customPopup');
const popupMsg = document.getElementById('popupMsg');
const closePopup = document.getElementById('closePopup');

function showPopup(msg) {
  popupMsg.textContent = msg;
  popup.classList.remove('hidden');
}

closePopup.addEventListener('click', () => {
  popup.classList.add('hidden');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorMsg.textContent = '';

  const name = document.getElementById('name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const dob = document.getElementById('dob').value;
  const workStatus = document.querySelector('input[name="workStatus"]:checked')?.value;
  const code = document.getElementById('code').value.trim();

  if (!workStatus) {
    errorMsg.textContent = 'Please select work status.';
    return;
  }

  try {
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, dob, workStatus, code })
    });

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 403) {
        showPopup ('Code is wrong SALA GARIB!🫶🖕');
      } else {
        showPopup(data.error || 'Something went wrong.');
      }
      return;
    }

    window.location.href = '/app.html';
  } catch (err) {
    showPopup('Network error. Please try again.');
  }
});
