"""Physical invariants for the V2 stoppage model; no match labels required."""
import unittest
import numpy as np
from possession_v2 import average, dead_probability, motion_evidence
from possession import decode
from games import GAME, GAMES, half_video_blocks

class MotionTests(unittest.TestCase):
    def test_stationary_ball_and_slow_players_raise_stoppage_evidence(self):
        stopped = dead_probability(1., 1., 0., False, 0.)
        live = dead_probability(0., 0., 1., False, 1.)
        self.assertGreater(stopped, .5)
        self.assertLess(live, .1)

    def test_missing_ball_is_not_a_stoppage_when_players_are_active(self):
        occluded = dead_probability(0., 0., 0., True, 1.)
        stopped = dead_probability(1., 0., 0., True, 0.)
        self.assertLess(occluded, .5)
        self.assertGreater(stopped, .5)

    def test_missing_values_do_not_become_zero_speed(self):
        np.testing.assert_allclose(average(np.array([2., np.nan, 4.]),1),[2.,3.,4.])
        self.assertTrue(np.isnan(average(np.full(5,np.nan),1)).all())

    def test_motion_clusters_exclude_ungraded_frames(self):
        n=GAMES[GAME]['n_video_frames']
        motion=np.full(n,1000.)
        for _,a,b in half_video_blocks(GAME):
            middle=(a+b)//2
            motion[a:middle]=.5
            motion[middle:b+1]=4.
        slow,report=motion_evidence(motion)
        low,high=report['motion_centres_m_s']
        self.assertAlmostEqual(low,.5,places=2)
        self.assertAlmostEqual(high,4.,places=2)
        self.assertGreater(slow[12000],.9)
        self.assertLess(slow[80000],.1)

    def test_decoder_preserves_half_boundaries_and_recovers_stoppage(self):
        n=GAMES[GAME]['n_video_frames']
        scores=np.tile([0.,-10.,-10.],(n,1))
        a=half_video_blocks(GAME)[0][1]
        scores[a+100:a+300]=[-10.,-10.,0.]
        labels=decode(scores)
        self.assertTrue((labels[a+100:a+300]=='D').all())
        self.assertEqual(labels[a+99],'H')
        self.assertEqual(labels[0],'X')
        self.assertEqual(labels[100000],'X')

if __name__=='__main__':
    unittest.main()
