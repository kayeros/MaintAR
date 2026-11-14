using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MaintARBackend.Context;
using MaintARBackend.Models;
using MaintARBackend.Services.Auth;
using MaintARBackend.Services.Email;

namespace MaintARBackend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly IJwtTokenService _jwtTokenService;
        private readonly IPasswordService _passwordService;
        private readonly IUserService _userService;
        private readonly IEmailVerificationService _emailVerificationService;
        private readonly IPasswordResetService _passwordResetService;
        private readonly IEmailService _emailService;
        private readonly ILogger<AuthController> _logger;
        private readonly IWebHostEnvironment _env;

        public AuthController(
            AppDbContext db,
            IJwtTokenService jwtTokenService,
            IPasswordService passwordService,
            IUserService userService,
            IEmailVerificationService emailVerificationService,
            IPasswordResetService passwordResetService,
            IEmailService emailService,
            ILogger<AuthController> logger,
            IWebHostEnvironment env)
        {
            _logger = logger;
            _env = env;
            _db = db;
            _jwtTokenService = jwtTokenService;
            _passwordService = passwordService;
            _userService = userService;
            _emailVerificationService = emailVerificationService;
            _passwordResetService = passwordResetService;
            _emailService = emailService;
        }

        [HttpPost("register")]
        public async Task<IActionResult> Register([FromBody] RegisterModel model)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            if (await _userService.EmailExistsAsync(model.Email))
            {
                return Conflict("User with this email already exists");
            }

            var entity = new User
            {
                UserName = model.UserName,
                Email = model.Email,
                PasswordHash = string.Empty
            };
            entity.PasswordHash = _passwordService.HashPassword(entity, model.Password);

            _db.Users.Add(entity);
            await _db.SaveChangesAsync();

            var token = CreateToken(entity);

            return Ok(new
            {
                Token = token,
                entity.UserName,
                entity.Email
            });
        }

        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] LoginModel model)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == model.Email);

            if (user == null)
            {
                return Unauthorized("Invalid email or password");
            }

            var result = _passwordService.VerifyPassword(user, user.PasswordHash, model.Password);

            if (result == PasswordVerificationResult.Failed)
            {
                return Unauthorized("Invalid email or password");
            }

            var token = CreateToken(user);

            return Ok(new
            {
                Token = token,
                user.UserName,
                user.Email
            });
        }

        [Authorize]
        [HttpPost("send-verification-code")]
        public async Task<IActionResult> SendVerificationCode()
        {
            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);

            if (user == null)
            {
                return BadRequest("User not found");
            }

            var code = await _emailVerificationService.GenerateCodeAsync(user);

            // В разработке код дублируется в консоль: тестовый ключ Resend шлёт письма только владельцу аккаунта.
            if (_env.IsDevelopment())
            {
                _logger.LogWarning("Код подтверждения для {Email}: {Code}", user.Email, code);
            }

            try
            {
                await _emailService.SendEmailAsync(new EmailDto
                {
                    To = user.Email,
                    Subject = "Код подтверждения почты",
                    Body = code,
                    TemplateType = EmailTemplateType.EmailVerification
                });
            }
            catch (Exception ex) when (_env.IsDevelopment())
            {
                _logger.LogError(ex, "Письмо с кодом не отправлено, код есть в консоли");
            }

            return Ok("Verification code has been sent");
        }

        [Authorize]
        [HttpPost("verify-email")]
        public async Task<IActionResult> VerifyEmail([FromBody] VerifyEmailModel model)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);

            if (user == null)
            {
                return BadRequest("Invalid or expired code");
            }

            var success = await _emailVerificationService.VerifyCodeAsync(user, model.Code);

            if (!success)
            {
                return BadRequest("Invalid or expired code");
            }

            // Новый токен уже с email_verified = true, старый остаётся с false.
            return Ok(new
            {
                Message = "Email verified successfully",
                Token = CreateToken(user)
            });
        }

        private string CreateToken(User user)
        {
            return _jwtTokenService.GenerateToken(
                user.Id.ToString(),
                user.UserName,
                [new Claim("email_verified", user.IsEmailVerified ? "true" : "false")]);
        }

        [HttpPost("forgot-password")]
        public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordModel model)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == model.Email);

            if (user != null)
            {
                var code = await _passwordResetService.GenerateCodeAsync(user);

                // В разработке код дублируется в консоль, как и код подтверждения почты.
                if (_env.IsDevelopment())
                {
                    _logger.LogWarning("Код восстановления пароля для {Email}: {Code}", user.Email, code);
                }

                try
                {
                    await _emailService.SendEmailAsync(new EmailDto
                    {
                        To = user.Email,
                        Subject = "Восстановление пароля",
                        Body = code,
                        TemplateType = EmailTemplateType.ResetPassword
                    });
                }
                catch (Exception ex) when (_env.IsDevelopment())
                {
                    _logger.LogError(ex, "Письмо с кодом не отправлено, код есть в консоли");
                }
            }

            return Ok("If this email is registered, a reset link has been sent");
        }

        [HttpPost("reset-password")]
        public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordModel model)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == model.Email);

            if (user == null)
            {
                return BadRequest("Invalid or expired code");
            }

            var isValid = await _passwordResetService.VerifyCodeAsync(user, model.Code);

            if (!isValid)
            {
                return BadRequest("Invalid or expired code");
            }

            await _passwordResetService.ResetPasswordAsync(user, model.NewPassword);

            return Ok("Password has been reset");
        }
    }
}
