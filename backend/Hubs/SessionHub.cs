using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;

namespace SmartAssur.Api.Hubs
{
    public class SessionHub : Hub
    {
        public async Task JoinSession(string sessionToken)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, sessionToken);
            await Clients.Caller.SendAsync("SessionJoined", sessionToken);
        }

        public async Task PairMobile(string sessionToken, object deviceInfo)
        {
            await Clients.Group(sessionToken).SendAsync("PhonePaired", new
            {
                SessionToken = sessionToken,
                DeviceInfo = deviceInfo,
                PairedAt = System.DateTime.UtcNow
            });
        }

        public async Task StepUpdated(string sessionToken, int step, object data)
        {
            await Clients.Group(sessionToken).SendAsync("StepChanged", new
            {
                Step = step,
                Data = data,
                UpdatedAt = System.DateTime.UtcNow
            });
        }

        public async Task ChallengeCompleted(string sessionToken, string challengeCode)
        {
            await Clients.Group(sessionToken).SendAsync("ChallengeVerified", new
            {
                SessionToken = sessionToken,
                ChallengeCode = challengeCode,
                Success = true
            });
        }
    }
}

