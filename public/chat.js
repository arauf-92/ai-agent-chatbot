const input = document.getElementById("userInput");
const submitButton = document.getElementById("submit");
const fileAttachment = document.getElementById("inputFile");
const fileName = document.getElementById("fileName");
const thinkCheck = document.getElementById("thinkCheck");
const userDiv = document.getElementById("userQuery");
const responseDiv = document.getElementById("response");
const thinking = document.getElementById("thinking");

const hour = new Date().getHours();
let greeting;

if (hour >= 5 && hour < 12) {
    greeting = "Good morning, what shall we think through?";
} else if (hour >= 12 && hour < 17) {
    greeting = "Good afternoon, what shall we think through?";
} else if (hour >= 17 && hour < 22) {
    greeting = "Good evening, what shall we think through?";
} else {
    greeting = "Hello, night owl";
}
const greet = document.getElementById("greeting");
greet.innerHTML = `<img src="chatbot.gif" class="chatbot-gif">${greeting}`;

input.addEventListener("input", function () {
    submitButton.disabled = input.value.trim() === "";
});

fileAttachment.addEventListener("change", function () {
    if (this.files.length > 0) {
        fileName.textContent = this.files[0].name;
    } else {
        fileName.textContent = "";
    }
});

submitButton.addEventListener("click", async () => {
    document.getElementById("greetingHeading").style.display = "none";

    const message = input.value.trim();
    if (!message) return;

    const think = thinkCheck.checked;
    const formData = new FormData();

    userDiv.textContent = message;
    userDiv.style.display = "block";

    formData.append("message", message);
    formData.append("think", think);
    if (fileAttachment.files.length > 0) {
        console.log("before: " + fileAttachment?.files?.length);
        formData.append("file", fileAttachment.files[0]);
    }

    thinking.style.display = "block";

    try {
        const response = await fetch("/submit", {
            method: "POST",
            body: formData
        });
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        const result = await response.json();
        responseDiv.innerHTML = result.reply || "Error: " + result.error;
        responseDiv.style.display = "block";
    } catch (err) {
        responseDiv.textContent = "Request failed: " + err.message;
        responseDiv.style.display = "block";
    } finally {
        thinking.style.display = "none";
        input.value = "";
        submitButton.disabled = true;
        fileAttachment.value = "";
        fileName.textContent = "";
        console.log("after: " + fileAttachment?.files?.length);
    }
});