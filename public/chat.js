const input = document.getElementById("userInput");
const submitButton = document.getElementById("submit");
const fileAttachment = document.getElementById("inputFile");
const fileName = document.getElementById("fileName");
const thinkCheck = document.getElementById("thinkCheck");
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

input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (!submitButton.disabled) {
            submitButton.click();
        }
    }
});

fileAttachment.addEventListener("change", function () {
    if (this.files.length > 0) {
        fileName.textContent = this.files[0].name;
    } else {
        fileName.textContent = "";
    }
});

function addBubble(role, htmlContent) {
    const bubble = document.createElement("p");
    bubble.className = role === 'user' ? 'user-bubble' : 'assistant-bubble';
    bubble.innerHTML = htmlContent;
    bubble.style.display = 'block';
    chatContainer.insertBefore(bubble, thinking);
    bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

submitButton.addEventListener("click", async () => {
    document.getElementById("greetingHeading").style.display = "none";

    const message = input.value.trim();
    if (!message) return;

    addBubble('user', message.replace(/</g, "&lt;"));

    const think = thinkCheck.checked;
    const formData = new FormData();

    formData.append("message", message);
    formData.append("think", think);
    if (fileAttachment.files.length > 0) {
        formData.append("file", fileAttachment.files[0]);
    }
    thinking.style.display = "block";
    input.value = "";

    try {
        const response = await fetch("/submit", {
            method: "POST",
            body: formData
        });
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        const result = await response.json();
        addBubble('assistant', result.reply || "Error: " + result.error);
    } catch (err) {
        addBubble('assistant', "Request failed: " + err.message);
    } finally {
        thinking.style.display = "none";
        input.value = "";
        submitButton.disabled = true;
        fileAttachment.value = "";
        fileName.textContent = "";
    }
});