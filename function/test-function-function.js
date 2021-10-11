export function testHandler(stop) {
	const expired_at = new Date("2050-01-01");
	const now = new Date();
	if (now > expired_at) {
		console.log("Crobjob has been stopped at ", now)
		stop();
	}
}